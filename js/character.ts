import spine from '../libs/spine-webgl.js';
import webgl = spine.webgl;
import outlineFragmentShader from '../shaders/OutlineFragment.glsl';
import outlineVertexShader from '../shaders/OutlineVertex.glsl';
import { CharacterModel } from './types.js';

const MOVING_SPEED = 30; // pixels per second

const GRAVITY = 1000; // pixels per second squared
const DRAG = 0.98; // air resistance
const MAX_VELOCITY = 1000; // maximum velocity in pixels per second
const MIN_VELOCITY = 5; // threshold for stopping
const BOUNCE_DAMPING = 0.7; // energy loss on bounce

// Canvas size in pixels (pixels in screen)
const CANVAS_WIDTH = 150;
const CANVAS_HEIGHT = 150;

const ANIMATION_NAMES = ["Relax", "Interact", "Move", "Sit" , "Sleep"];
const ANIMATION_MARKOV = [
    [0.5, 0.0, 0.25, 0.15, 0.1],
    [1.0, 0.0, 0.0, 0.0, 0.0],
    [0.2, 0.0, 0.8, 0.0, 0.0],
    [0.3, 0.0, 0.0, 0.7, 0.0],
    [0.1, 0.0, 0.0, 0.0, 0.9],
]

// Vehicle can't sit & sleep
const ANIMATION_NAMES_VEHICLE = ["Relax", "Interact", "Move"];
const ANIMATION_MARKOV_VEHICLE = [
    [0.5, 0.0, 0.5],
    [1.0, 0.0, 0.0],
    [0.3, 0.0, 0.7],
]

interface SpineCharacter {
    skeleton: spine.Skeleton;
    state: spine.AnimationState;
}

interface Action {
    animation: string;
    direction: Direction;
    timestamp: number;
}

type Direction = "left" | "right";

export class Character {
    private canvas!: HTMLCanvasElement;
    private gl!: WebGLRenderingContext;
    private shader!: webgl.Shader;
    private batcher!: webgl.PolygonBatcher;
    private mvp!: webgl.Matrix4;
    private assetManager!: webgl.AssetManager;
    private skeletonRenderer!: webgl.SkeletonRenderer;
    private lastFrameTime!: number;
    private framebuffer!: WebGLFramebuffer;
    private framebufferTexture!: WebGLTexture;
    private outlineShader!: WebGLProgram;
    private quadBuffer!: WebGLBuffer;

    private isMouseOver: boolean = false;
    
    // Dragging state
    private isDragging: boolean = false;
    private dragStartRelativeX: number = 0;
    private dragStartRelativeY: number = 0;
    private lastDragEvent: MouseEvent | null = null;
    
    // Physics state
    private velocity = { x: 0, y: 0 };
    
    private model: CharacterModel;
    private character!: SpineCharacter;
    
    private currentAction: Action = {
        animation: "Relax",
        direction: "right",
        timestamp: 0
    };
    
    private position: { x: number; y: number } = {
        x: -1, // will be set to a random value
        y: 1e9 // will be bounded to the bottom of the window
    };

    private animationFrameId: number | null = null;

    // Vehicle can't sit & sleep
    private isVehicle: boolean = false;

    private allowInteract: boolean = true;

    // Supersampling is necessary for high-res display
    private pixelRatio!: number;

    constructor(canvasId: string, onContextMenu: (e: MouseEvent | TouchEvent) => void, initialCharacter: CharacterModel, allowInteract: boolean = true) {
        this.allowInteract = allowInteract;
        this.model = initialCharacter;
        this.mvp = new webgl.Matrix4();
        this.pixelRatio = window.devicePixelRatio ?? 2;
        
        // Initialize canvas and WebGL
        this.initializeCanvas(canvasId);
        this.initializeWebGL();
        this.setupEventListeners(onContextMenu);
        
        // Load initial character
        this.loadFromSessionStorage();
        this.loadCharacterModel(this.model);
    }

    private initializeCanvas(canvasId: string): void {
        this.canvas = document.createElement('canvas');
        this.canvas.classList.add("arkpets-canvas");
        this.canvas.id = canvasId;
        document.body.appendChild(this.canvas);
        this.canvas.style.pointerEvents = "none";
    }

    private initializeWebGL(): void {
        this.gl = this.canvas.getContext("webgl", {
            alpha: true,
            premultipliedAlpha: false
        }) as WebGLRenderingContext;

        if (!this.gl) {
            throw new Error('WebGL is unavailable.');
        }

        // Set up WebGL context
        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
        
        this.initFramebuffer();
        
        // Create WebGL objects
        this.shader = webgl.Shader.newTwoColoredTextured(this.gl);
        this.batcher = new webgl.PolygonBatcher(this.gl);
        this.skeletonRenderer = new webgl.SkeletonRenderer(new webgl.ManagedWebGLRenderingContext(this.gl));
        this.assetManager = new webgl.AssetManager(this.gl);
    }

    private setupEventListeners(onContextMenu: (e: MouseEvent | TouchEvent) => void): void {
        // Track mouse position to decide mouse over
        document.addEventListener('mousemove', this.handleMouseMove.bind(this));

        if (this.allowInteract) {
            // React to click events
            this.canvas.addEventListener('click', this.handleCanvasClick.bind(this));

            // Context menu
            this.canvas.addEventListener('contextmenu', onContextMenu);

            // Mouse events
            this.canvas.addEventListener('mousedown', this.handleDragStart.bind(this));
            document.addEventListener('mousemove', this.handleDrag.bind(this));
            document.addEventListener('mouseup', this.handleDragEnd.bind(this));
            
            // Touch events
            this.canvas.addEventListener('touchstart', this.handleDragStart.bind(this));
            document.addEventListener('touchmove', this.handleDrag.bind(this));
            document.addEventListener('touchend', this.handleDragEnd.bind(this));
        }
    }

    private initFramebuffer(): void {
        // Create and bind framebuffer
        this.framebuffer = this.gl.createFramebuffer()!;
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffer);

        // Create and bind texture
        this.framebufferTexture = this.gl.createTexture()!;
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.framebufferTexture);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.canvas.width, this.canvas.height, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, null);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);

        // Attach texture to framebuffer
        this.gl.framebufferTexture2D(this.gl.FRAMEBUFFER, this.gl.COLOR_ATTACHMENT0, this.gl.TEXTURE_2D, this.framebufferTexture, 0);

        // Create quad buffer for second pass
        this.quadBuffer = this.gl.createBuffer()!;
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array([
            -1, -1,  // Bottom left
             1, -1,  // Bottom right
            -1,  1,  // Top left
             1,  1   // Top right
        ]), this.gl.STATIC_DRAW);

        // Create and compile outline shader
        const vertexShader = this.gl.createShader(this.gl.VERTEX_SHADER)!;
        this.gl.shaderSource(vertexShader, outlineVertexShader);
        this.gl.compileShader(vertexShader);

        const fragmentShader = this.gl.createShader(this.gl.FRAGMENT_SHADER)!;
        this.gl.shaderSource(fragmentShader, outlineFragmentShader);
        this.gl.compileShader(fragmentShader);

        // Compile shaders
        this.gl.compileShader(vertexShader);
        if (!this.gl.getShaderParameter(vertexShader, this.gl.COMPILE_STATUS)) {
            console.error('Vertex shader compilation failed:', this.gl.getShaderInfoLog(vertexShader));
        }
        this.gl.compileShader(fragmentShader);
        if (!this.gl.getShaderParameter(fragmentShader, this.gl.COMPILE_STATUS)) {
            console.error('Fragment shader compilation failed:', this.gl.getShaderInfoLog(fragmentShader));
        }
        this.outlineShader = this.gl.createProgram()!;
        this.gl.attachShader(this.outlineShader, vertexShader);
        this.gl.attachShader(this.outlineShader, fragmentShader);
        this.gl.linkProgram(this.outlineShader);
        if (!this.gl.getProgramParameter(this.outlineShader, this.gl.LINK_STATUS)) {
            console.error('Program linking failed:', this.gl.getProgramInfoLog(this.outlineShader));
        }
    }

    public loadCharacterModel(model: CharacterModel) {
        this.model = model;
        
        function encodeUriPath(path: string): string {
            return encodeURIComponent(path).replace(/%2F/g, '/');
        }
        console.log("Downloading character assets for", model.name);

        // Download all resources.
        // Here we use `setRawDataURI()` to manually load the resources because the path may contain `#` which is not allowed in URLs
        const resources = [model.skeleton, model.atlas, model.texture];
        const basePath = model.resourcePath ?? "";
        Promise.all(resources.map(async resource => {
            const response = await fetch(basePath + encodeUriPath(resource));
            const blob = await response.blob();
            const reader = new FileReader();
            return new Promise<string>(resolve => {
                reader.onloadend = () => resolve(reader.result as string);
                reader.readAsDataURL(blob);
            });
        })).then(dataUrls => {
            resources.forEach((resource, i) => {
                this.assetManager.setRawDataURI(resource, dataUrls[i]);
            });

            this.assetManager.removeAll();
            this.assetManager.loadBinary(model.skeleton, () => {
                this.assetManager.loadTextureAtlas(model.atlas, () => {
                    console.log("Loaded character assets for", model.name);
                    resources.forEach((resource) => {
                        this.assetManager.setRawDataURI(resource, ""); // release memory
                    });
                    requestAnimationFrame(this.load.bind(this));
                });
            });
        }).catch(error => {
            console.error("Failed to load character assets:", error);
        });

        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    public fadeOut(): Promise<void> {
        return new Promise((resolve) => {
            let opacity = 1;
            const fadeInterval = setInterval(() => {
                opacity -= 0.1;
                this.canvas.style.opacity = opacity.toString();
                
                if (opacity <= 0) {
                    clearInterval(fadeInterval);
                    resolve();
                }
            }, 30);
        });
    }

    private saveToSessionStorage(): void {
        sessionStorage.setItem('arkpets-character-' + this.canvas.id, JSON.stringify({
            position: this.position,
            currentAction: this.currentAction,
            characterResource: this.model
        }));
    }

    private loadFromSessionStorage(): void {
        const saved = sessionStorage.getItem('arkpets-character-' + this.canvas.id);
        if (saved) {
            const state = JSON.parse(saved);
            this.position = state.position;
            this.currentAction = state.currentAction;
            this.model = state.characterResource;
        }
    }

    private load(): void {
        if (this.assetManager.isLoadingComplete()) {
            this.character = this.loadCharacter(this.model, 0.3 * 0.75 * this.pixelRatio);

            if (!this.getAnimationNames().includes(this.currentAction.animation)) {
                // If swithing from character to vehicle, make sure it's not in `Sleep` or `Sit`
                this.currentAction.animation = "Relax";
                this.currentAction.timestamp = 0;
            }
            this.character.state.setAnimation(0, this.currentAction.animation, true);
            this.character.state.update(this.currentAction.timestamp);

            this.lastFrameTime = Date.now() / 1000;

            // Generate random x position if it's not set yet
            if (this.position.x === -1) {
                this.position.x = Math.random() * (window.innerWidth - this.canvas.offsetWidth);
            }

            requestAnimationFrame(this.render.bind(this));
        } else {
            console.debug("Loading assets of character", this.model.name, "progress", this.assetManager.getLoaded(), "/", this.assetManager.getToLoad());
            requestAnimationFrame(this.load.bind(this));
        }
    }

    private loadCharacter(resource: CharacterModel, scale: number = 1.0): SpineCharacter {    
        const atlas = this.assetManager.get(resource.atlas);
        const atlasLoader = new spine.AtlasAttachmentLoader(atlas);
        const skeletonBinary = new spine.SkeletonBinary(atlasLoader);

        skeletonBinary.scale = scale;
        const skeletonData = skeletonBinary.readSkeletonData(this.assetManager.get(resource.skeleton));
        const skeleton = new spine.Skeleton(skeletonData);

        if (!skeletonData.findAnimation("Sit") || !skeletonData.findAnimation("Sleep")) {
            this.isVehicle = true;
        }

        const animationStateData = new spine.AnimationStateData(skeleton.data);

        // Animation transitions
        this.getAnimationNames().forEach(fromAnim => {
            this.getAnimationNames().forEach(toAnim => {
                if (fromAnim !== toAnim) {
                    animationStateData.setMix(fromAnim, toAnim, 0.3);
                }
            });
        });

        const animationState = new spine.AnimationState(animationStateData);
        animationState.setAnimation(0, "Relax", true);

        // Listen for animation completion
        const self = this;
        class AnimationStateAdapter extends spine.AnimationStateAdapter {
            complete(entry: spine.TrackEntry): void {
                const action = self.nextAction(self.currentAction);
                self.currentAction = action;
                console.debug("Play action", action)
                animationState.setAnimation(0, action.animation, true);
            }
        }
        animationState.addListener(new AnimationStateAdapter());

        // Set canvas display size
        this.canvas.style.width = CANVAS_WIDTH + "px";
        this.canvas.style.height = CANVAS_HEIGHT + "px";

        // Set canvas internal resolution
        this.canvas.width = CANVAS_WIDTH * this.pixelRatio;
        this.canvas.height = CANVAS_HEIGHT * this.pixelRatio;
        
        // Update the projection matrix to match the new resolution
        this.mvp.ortho2d(0, 0, this.canvas.width, this.canvas.height);
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);

        // Scale up the skeleton position to match the higher resolution
        skeleton.x = this.canvas.width / 2;
        skeleton.y = 0;

        // Update framebuffer texture size
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.framebufferTexture);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.canvas.width, this.canvas.height, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, null);

        return {
            skeleton,
            state: animationState,
        };
    }

    // Mouse position (client, no transform, no supersampling)
    private currentMousePos = { x: 0, y: 0 };

    private handleMouseMove(event: MouseEvent): void {
        this.currentMousePos.x = event.clientX;
        this.currentMousePos.y = event.clientY;
    }

    private render(): void {
        const now = Date.now() / 1000;
        // Limit delta to 0.1s, effectively pausing the animation when the window is in background
        const delta = Math.min(now - this.lastFrameTime, 0.1);
        this.lastFrameTime = now;
        this.currentAction.timestamp += delta;

        // Apply physics when not dragging
        if (!this.isDragging) {
            // Apply gravity
            this.velocity.y += GRAVITY * delta;
            
            // Apply drag
            this.velocity.x *= DRAG;
            this.velocity.y *= DRAG;
            if (Math.abs(this.velocity.x) < MIN_VELOCITY) {
                this.velocity.x = 0;
            }
            if (Math.abs(this.velocity.y) < MIN_VELOCITY) {
                this.velocity.y = 0;
            }
            
            // Clamp velocities
            this.velocity.x = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, this.velocity.x));
            this.velocity.y = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, this.velocity.y));
            
            // Update position
            this.position.x += this.velocity.x * delta;
            this.position.y += this.velocity.y * delta;
            
            // Window bounds collision
            const maxX = window.innerWidth - this.canvas.offsetWidth;
            const maxY = window.innerHeight - this.canvas.offsetHeight;
            
            // Bounce off walls
            if (this.position.x < 0) {
                this.position.x = 0;
                this.velocity.x = -this.velocity.x * BOUNCE_DAMPING;
            } else if (this.position.x > maxX) {
                this.position.x = maxX;
                this.velocity.x = -this.velocity.x * BOUNCE_DAMPING;
            }
            
            // Bounce off floor/ceiling
            if (this.position.y < 0) {
                this.position.y = 0;
                this.velocity.y = 0;
            } else if (this.position.y > maxY) {
                this.position.y = maxY;
                this.velocity.y = 0;
            }
        }

        // Move the canvas when "Move" animation is playing
        if (this.currentAction.animation === "Move") {
            const movement = MOVING_SPEED * delta;
            if (this.currentAction.direction === "left") {
                this.position.x = Math.max(0, this.position.x - movement);
                // Turn around when reaching left edge
                if (this.position.x <= 0) {
                    this.position.x = 0;
                    this.currentAction.direction = "right";
                }
            } else {
                this.position.x = this.position.x + movement;
                // Turn around when reaching right edge
                if (this.position.x >= window.innerWidth - this.canvas.offsetWidth) {
                    this.position.x = window.innerWidth - this.canvas.offsetWidth;
                    this.currentAction.direction = "left";
                }
            }
        }

        // Update canvas position to `position`
        this.canvas.style.transform = `translate(${this.position.x}px, ${this.position.y}px)`;

        // 1st pass - render Spine character to framebuffer
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffer);
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        this.gl.clearColor(0, 0, 0, 0);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        
        this.character.skeleton.scaleX = this.currentAction.direction === "left" ? -1 : 1;

        this.character.state.update(delta);
        this.character.state.apply(this.character.skeleton);
        this.character.skeleton.updateWorldTransform();

        this.shader.bind();
        this.shader.setUniformi(webgl.Shader.SAMPLER, 0);
        this.shader.setUniform4x4f(webgl.Shader.MVP_MATRIX, this.mvp.values);

        this.batcher.begin(this.shader);
        this.skeletonRenderer.premultipliedAlpha = false;
        this.skeletonRenderer.draw(this.batcher, this.character.skeleton);
        this.batcher.end();

        this.shader.unbind();

        // Read pixels before 2nd pass to determine if mouse is over character
        const canvasRect = this.canvas.getBoundingClientRect();
        let pixelX = (this.currentMousePos.x - canvasRect.x) * this.pixelRatio;
        let pixelY = this.canvas.height - (this.currentMousePos.y - canvasRect.y) * this.pixelRatio;
        if (pixelX >= 0 && pixelX < this.canvas.width && pixelY >= 0 && pixelY < this.canvas.height) {
            // Mouse inside canvas. Check whether it's over the character
            let pixelColor = new Uint8Array(4);
            this.gl.readPixels(
                pixelX, 
                pixelY, 
                1, 1, 
                this.gl.RGBA, 
                this.gl.UNSIGNED_BYTE, 
                pixelColor
            );
            this.isMouseOver = pixelColor[3] !== 0;
            if (this.allowInteract) {
                this.canvas.style.pointerEvents = this.isMouseOver ? 'auto' : 'none';
            } else {
                this.canvas.style.pointerEvents = 'none';
            }
        } else {
            this.isMouseOver = false;
            this.canvas.style.pointerEvents = 'none';
        }

        // 2nd pass - render to screen with outline effect
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        this.gl.clearColor(0, 0, 0, 0);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);

        this.gl.useProgram(this.outlineShader);

        // Set uniforms
        const uTexture = this.gl.getUniformLocation(this.outlineShader, "u_texture");
        const uOutlineColor = this.gl.getUniformLocation(this.outlineShader, "u_outlineColor");
        const uOutlineWidth = this.gl.getUniformLocation(this.outlineShader, "u_outlineWidth");
        const uTextureSize = this.gl.getUniformLocation(this.outlineShader, "u_textureSize");
        const uAlpha = this.gl.getUniformLocation(this.outlineShader, "u_alpha");

        this.gl.uniform1i(uTexture, 0); // Use texture unit 0 for spine character
        this.gl.uniform4f(uOutlineColor, 1.0, 1.0, 0.0, 1.0); // yellow
        this.gl.uniform1f(uOutlineWidth, this.allowInteract && this.isMouseOver ? 2.0 : 0.0); // Show outline only in interactive mode
        this.gl.uniform2i(uTextureSize, this.canvas.width, this.canvas.height);
        this.gl.uniform1f(uAlpha, (!this.allowInteract && this.isMouseOver) ? 0.3 : 1.0); // Reduce opacity when non-interactive and mouse over

        // Bind framebuffer texture
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.framebufferTexture);

        // Draw quad to canvas
        const aPosition = this.gl.getAttribLocation(this.outlineShader, "a_position");
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadBuffer);
        this.gl.enableVertexAttribArray(aPosition);
        this.gl.vertexAttribPointer(aPosition, 2, this.gl.FLOAT, false, 0, 0);
        this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);

        this.saveToSessionStorage();

        // Store the animation frame ID
        this.animationFrameId = requestAnimationFrame(this.render.bind(this));
    }

    private randomPick(probabilities: number[]): number {
        let random = Math.random();
        let cumulativeProb = 0;
        for (let i = 0; i < probabilities.length; i++) {
            cumulativeProb += probabilities[i];
            if (random <= cumulativeProb) {
                return i;
            }
        }
        throw new Error("Invalid probabilities: " + probabilities);
    }

    private turnDirection(current: Direction): Direction {
        return current === "left" ? "right" : "left";
    }

    private nextAction(current: Action): Action {
        const animeIndex = this.getAnimationNames().indexOf(current.animation);
        const nextIndexProb = this.getAnimationMarkov()[animeIndex];
        const nextAnimIndex = this.randomPick(nextIndexProb);
        const nextAnim = this.getAnimationNames()[nextAnimIndex];

        let nextDirection = current.direction;
        if (current.animation === "Relax" && nextAnim === "Move") {
            nextDirection = Math.random() < 0.4 ? this.turnDirection(current.direction) : current.direction;
        }
        return {
            animation: nextAnim,
            direction: nextDirection,
            timestamp: 0
        };
    }

    private handleCanvasClick(): void {
        if (this.character && this.character.state) {
            this.currentAction = {
                animation: "Interact",
                direction: this.currentAction.direction,
                timestamp: 0,
            };
            this.character.state.setAnimation(0, "Interact", false);
            console.debug("Play action", this.currentAction);
        }
    }

    private handleDragStart(e: MouseEvent | TouchEvent): void {
        if ((e as MouseEvent).button === undefined || (e as MouseEvent).button === 0) {
            this.isDragging = true;
            
            const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
            const clientY = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY;
            this.dragStartRelativeX = clientX - this.position.x;
            this.dragStartRelativeY = clientY - this.position.y;
            
            // Pause any current animation
            if (this.character && this.character.state) {
                this.character.state.setAnimation(0, "Relax", true);
                this.currentAction = {
                    animation: "Relax",
                    direction: this.currentAction.direction,
                    timestamp: 0
                };
            }
        }
    }

    private handleDrag(e: MouseEvent | TouchEvent): void {
        if (this.isDragging) {
            const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
            const clientY = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY;
            
            const oldX = this.position.x;
            const oldY = this.position.y;
            const newX = clientX - this.dragStartRelativeX;
            const newY = clientY - this.dragStartRelativeY;
            
            // Calculate velocity based on time between events
            if (this.lastDragEvent) {
                const dt = (e.timeStamp - this.lastDragEvent.timeStamp) / 1000;
                if (dt > 0) {
                    this.velocity.x = (newX - oldX) / dt;
                    this.velocity.y = (newY - oldY) / dt;
                }
            }
            
            // Update position
            this.position.x = newX;
            this.position.y = newY;
            this.canvas.style.transform = `translate(${this.position.x}px, ${this.position.y}px)`;
            
            this.lastDragEvent = e as MouseEvent;
            
            // Prevent scrolling on mobile
            if ('touches' in e) {
                e.preventDefault();
            }
        }
    }

    private handleDragEnd(): void {
        this.isDragging = false;
        this.lastDragEvent = null;
    }

    public destroy(): void {
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        // Remove event listeners
        this.canvas.removeEventListener('click', this.handleCanvasClick.bind(this));
        this.canvas.removeEventListener('mousedown', this.handleDragStart.bind(this));
        document.removeEventListener('mousemove', this.handleMouseMove.bind(this));
        document.removeEventListener('mousemove', this.handleDrag.bind(this));
        document.removeEventListener('mouseup', this.handleDragEnd.bind(this));
        this.canvas.removeEventListener('touchstart', this.handleDragStart.bind(this));
        document.removeEventListener('touchmove', this.handleDrag.bind(this));
        document.removeEventListener('touchend', this.handleDragEnd.bind(this));

        // Clean up Spine resources
        if (this.character) {
            this.character.state.clearTracks();
            this.character.state.clearListeners();
        }
        
        // Delete WebGL resources
        this.gl.deleteFramebuffer(this.framebuffer);
        this.gl.deleteTexture(this.framebufferTexture);
        this.gl.deleteBuffer(this.quadBuffer);
        this.gl.deleteProgram(this.outlineShader);
        
        // Clear session storage
        sessionStorage.removeItem('arkpets-character-' + this.canvas.id);
        
        // Clear asset manager
        this.assetManager.removeAll();
        this.assetManager.dispose();

        // Remove canvas
        this.canvas.remove();
    }

    public getAnimationNames(): string[] {
        return this.isVehicle ? ANIMATION_NAMES_VEHICLE : ANIMATION_NAMES;
    }

    private getAnimationMarkov(): number[][] {
        return this.isVehicle ? ANIMATION_MARKOV_VEHICLE : ANIMATION_MARKOV;
    }

    public playAnimation(animationName: string): void {
        this.currentAction = {
            animation: animationName,
            direction: this.currentAction.direction,
            timestamp: 0,
        };
        this.character.state.setAnimation(0, animationName, true);
        console.debug("Play action", this.currentAction);
    }

    public getCanvasId(): string {
        return this.canvas.id;
    }

    public getModel(): CharacterModel {
        return this.model;
    }

    public isAllowInteract(): boolean {
        return this.allowInteract;
    }

    public setAllowInteract(allowInteract: boolean): void {
        this.allowInteract = allowInteract;
    }
}