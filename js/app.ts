import spine from '../libs/spine-webgl.js';
import webgl = spine.webgl;
import outlineFragmentShader from '../shaders/OutlineFragment.glsl';

// Core variables
let canvas: HTMLCanvasElement;
let gl: WebGLRenderingContext;
let shader: webgl.Shader;
let batcher: webgl.PolygonBatcher;
let mvp = new webgl.Matrix4();
let assetManager: webgl.AssetManager;
let skeletonRenderer: webgl.SkeletonRenderer;
let lastFrameTime: number;
let framebuffer: WebGLFramebuffer;
let framebufferTexture: WebGLTexture;
let outlineShader: WebGLProgram;
let quadBuffer: WebGLBuffer;

// Dragging
let isDragging = false;
let dragStartX = 0;
let canvasStartLeft = 0;


const RESOURCE_PATH = "assets/models/";

// Supersampling is necessary for high-res display
const SUPERSAMPLE_FACTOR = 2;

interface CharacterResource {
    name: string;
    skeleton: string;
    atlas: string;
    texture: string;
}

const CHARACTER_RESOURCES: CharacterResource[] = [
    {
        name: "佩佩",
        skeleton: "4058_pepe/build_char_4058_pepe.skel",
        atlas: "4058_pepe/build_char_4058_pepe.atlas",
        texture: "4058_pepe/build_char_4058_pepe.png",
    },
    {
        name: "荒芜拉普兰德",
        skeleton: "1038_whitw2/build_char_1038_whitw2.skel", 
        atlas: "1038_whitw2/build_char_1038_whitw2.atlas",
        texture: "1038_whitw2/build_char_1038_whitw2.png",
    },
];

let characterResource: CharacterResource = CHARACTER_RESOURCES[0];

interface Character {
    skeleton: spine.Skeleton;
    state: spine.AnimationState;
    bounds: {
        offset: spine.Vector2;
        size: spine.Vector2;
    };
    currentAction: Action;
}

type Direction = "left" | "right";

interface Action {
    animation: string;
    direction: Direction;
}

let character: Character;

const ANIMATION_NAMES = ["Relax", "Interact", "Move", "Sit" , "Sleep"];
const ANIMATION_MARKOV = [
    [0.5, 0.0, 0.25, 0.15, 0.1],
    [1.0, 0.0, 0.0, 0.0, 0.0],
    [0.3, 0.0, 0.7, 0.0, 0.0],
    [0.5, 0.0, 0.0, 0.5, 0.0],
    [0.3, 0.0, 0.0, 0.0, 0.7],
]

function createContextMenu() {
    const menu = document.createElement('div');
    menu.id = 'contextMenu';
    menu.style.display = 'none';
    menu.style.position = 'fixed';
    menu.style.zIndex = '1000';
    menu.style.backgroundColor = 'white';
    menu.style.border = '1px solid #ccc';
    menu.style.padding = '5px 0';
    menu.style.boxShadow = '2px 2px 5px rgba(0,0,0,0.2)';
    menu.style.fontSize = '14px';
    
    // Create Characters submenu
    const charactersMenu = document.createElement('div');
    charactersMenu.className = 'menu-item';
    charactersMenu.innerHTML = 'Characters ►';
    charactersMenu.style.padding = '5px 20px';
    charactersMenu.style.cursor = 'pointer';
    
    const charactersList = document.createElement('div');
    charactersList.className = 'submenu';
    charactersList.style.display = 'none';
    charactersList.style.position = 'absolute';
    charactersList.style.left = '100%';
    charactersList.style.top = '0';
    charactersList.style.backgroundColor = 'white';
    charactersList.style.border = '1px solid #ccc';
    charactersList.style.padding = '5px 0';
    charactersList.style.minWidth = '150px';
    
    // Add hover styles to menu items
    const menuItemStyle = {
        padding: '5px 20px',
        cursor: 'pointer',
    };

    const applyMenuItemStyles = (element: HTMLElement) => {
        Object.assign(element.style, menuItemStyle);
        const originalMouseover = element.onmouseover;
        const originalMouseout = element.onmouseout;
        element.onmouseover = (e) => {
            element.style.backgroundColor = '#f0f0f0';
            if (originalMouseover) originalMouseover.call(element, e);
        };
        element.onmouseout = (e) => {
            element.style.backgroundColor = 'white';
            if (originalMouseout) originalMouseout.call(element, e);
        };
    };

    // Apply to character list items
    CHARACTER_RESOURCES.forEach(char => {
        const item = document.createElement('div');
        item.innerHTML = char.name;
        applyMenuItemStyles(item);
        item.onclick = () => {
            menu.style.display = 'none';
            assetManager.removeAll();
            assetManager.loadBinary(char.skeleton);
            assetManager.loadTextureAtlas(char.atlas);
            characterResource = char;
            requestAnimationFrame(load);
        };
        charactersList.appendChild(item);
    });
    
    charactersMenu.appendChild(charactersList);
    charactersMenu.onmouseover = () => charactersList.style.display = 'block';
    charactersMenu.onmouseout = () => charactersList.style.display = 'none';
    
    // Apply to Characters menu
    applyMenuItemStyles(charactersMenu);
    
    // Create About menu item
    const aboutMenu = document.createElement('div');
    aboutMenu.className = 'menu-item';
    aboutMenu.innerHTML = 'About';
    aboutMenu.style.padding = '5px 20px';
    aboutMenu.style.cursor = 'pointer';
    aboutMenu.onclick = () => {
        menu.style.display = 'none';
        window.open('https://github.com/fuyufjh/ArkPets-Web/', '_blank');
    };

    // Apply to About menu
    applyMenuItemStyles(aboutMenu);

    // Create Hide menu item
    const hideMenu = document.createElement('div');
    hideMenu.className = 'menu-item';
    hideMenu.innerHTML = 'Hide';
    hideMenu.onclick = () => {
        menu.style.display = 'none';
        hideCharacter();
    };

    // Apply to Hide menu
    applyMenuItemStyles(hideMenu);
    
    menu.appendChild(charactersMenu);
    menu.appendChild(hideMenu);
    menu.appendChild(aboutMenu);
    document.body.appendChild(menu);
    return menu;
}

function hideCharacter(): void {
    if (canvas) {
        // Fade out animation
        let opacity = 1;
        const fadeInterval = setInterval(() => {
            opacity -= 0.1;
            canvas.style.opacity = opacity.toString();
            
            if (opacity <= 0) {
                clearInterval(fadeInterval);
                canvas.style.display = 'none';
            }
        }, 30);
    }
}

function init(): void {
    // Setup canvas and WebGL context
    canvas = document.getElementById("canvas") as HTMLCanvasElement;
    canvas.style.pointerEvents = "none";
    
    gl = canvas.getContext("webgl", {
        alpha: true,
        premultipliedAlpha: false
    }) as WebGLRenderingContext;

    if (!gl) {
        alert('WebGL is unavailable.');
        return;
    }

    // Set up blending for non-premultiplied alpha
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Create WebGL objects
    shader = webgl.Shader.newTwoColoredTextured(gl);
    batcher = new webgl.PolygonBatcher(gl);
    skeletonRenderer = new webgl.SkeletonRenderer(new webgl.ManagedWebGLRenderingContext(gl));
    assetManager = new webgl.AssetManager(gl, RESOURCE_PATH);

    // Load assets for initial character
    assetManager.loadBinary(characterResource.skeleton);
    assetManager.loadTextureAtlas(characterResource.atlas);

    // Add click event listener to canvas
    canvas.addEventListener('click', handleCanvasClick);

    requestAnimationFrame(load);

    const contextMenu = createContextMenu();
    
    // Add context menu event listeners
    canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const menu = document.getElementById('contextMenu');
        if (menu) {
            // Temporarily make menu visible but transparent to measure dimensions
            menu.style.opacity = '0';
            menu.style.display = 'block';
            const { innerWidth, innerHeight } = window;
            const { offsetWidth, offsetHeight } = menu;
            menu.style.left = Math.min(e.pageX, innerWidth - offsetWidth) + 'px';
            menu.style.top = Math.min(e.pageY, innerHeight - offsetHeight) + 'px';
            menu.style.opacity = '1';
        }
    });
    
    // Hide menu when clicking outside
    document.addEventListener('click', (e) => {
        const menu = document.getElementById('contextMenu');
        if (menu) {
            menu.style.display = 'none';
        }
    });

    document.addEventListener('mousemove', handleMouseMove);

    initFramebuffer();

    // Add drag event listeners
    canvas.addEventListener('mousedown', handleDragStart);
    document.addEventListener('mousemove', handleDrag);
    document.addEventListener('mouseup', handleDragEnd);
}

function initFramebuffer(): void {
    // Create and bind framebuffer
    framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);

    // Create and bind texture
    framebufferTexture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, framebufferTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Attach texture to framebuffer
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, framebufferTexture, 0);

    // Create quad buffer for second pass
    quadBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1,  // Bottom left
         1, -1,  // Bottom right
        -1,  1,  // Top left
         1,  1   // Top right
    ]), gl.STATIC_DRAW);

    // Create and compile outline shader
    const vertexShader = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vertexShader, `
        attribute vec2 a_position;
        varying vec2 v_texCoord;
        void main() {
            gl_Position = vec4(a_position, 0.0, 1.0);
            v_texCoord = a_position * 0.5 + 0.5;
        }
    `);
    gl.compileShader(vertexShader);

    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fragmentShader, outlineFragmentShader);
    gl.compileShader(fragmentShader);

    // Add error checking for vertex shader compilation
    gl.compileShader(vertexShader);
    if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
        console.error('Vertex shader compilation failed:');
        console.error(gl.getShaderInfoLog(vertexShader));
    }

    // Add error checking for fragment shader compilation
    gl.compileShader(fragmentShader);
    if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
        console.error('Fragment shader compilation failed:');
        console.error(gl.getShaderInfoLog(fragmentShader));
    }

    // Create and link program
    outlineShader = gl.createProgram()!;
    gl.attachShader(outlineShader, vertexShader);
    gl.attachShader(outlineShader, fragmentShader);
    gl.linkProgram(outlineShader);

    // Add error checking for program linking
    if (!gl.getProgramParameter(outlineShader, gl.LINK_STATUS)) {
        console.error('Program linking failed:');
        console.error(gl.getProgramInfoLog(outlineShader));
    }
}

function load(): void {
    if (assetManager.isLoadingComplete()) {
        character = loadCharacter(characterResource, 0.3 * 0.75 * SUPERSAMPLE_FACTOR);
        lastFrameTime = Date.now() / 1000;
        
        resize();

        requestAnimationFrame(render);
    } else {
        console.log("Loading assets of character", characterResource.name, "progress", assetManager.getLoaded(), "/", assetManager.getToLoad());
        requestAnimationFrame(load);
    }
}

function loadCharacter(resource: CharacterResource, scale: number = 1.0): Character {    
    const atlas = assetManager.get(resource.atlas);
    const atlasLoader = new spine.AtlasAttachmentLoader(atlas);
    const skeletonBinary = new spine.SkeletonBinary(atlasLoader);

    skeletonBinary.scale = scale;
    const skeletonData = skeletonBinary.readSkeletonData(assetManager.get(resource.skeleton));
    const skeleton = new spine.Skeleton(skeletonData);
    const bounds = calculateSetupPoseBounds(skeleton);

    const animationStateData = new spine.AnimationStateData(skeleton.data);

    // Animation transitions
    ANIMATION_NAMES.forEach(fromAnim => {
        ANIMATION_NAMES.forEach(toAnim => {
            if (fromAnim !== toAnim) {
                animationStateData.setMix(fromAnim, toAnim, 0.3);
            }
        });
    });

    const animationState = new spine.AnimationState(animationStateData);
    animationState.setAnimation(0, "Relax", true);

    // Listen for animation completion
    class AnimationStateAdapter extends spine.AnimationStateAdapter {
        complete(entry: spine.TrackEntry): void {
            const action = nextAction(character.currentAction);
            character.currentAction = action;
            console.log("Play action", action)
            animationState.setAnimation(0, action.animation, true);
        }
    }
    animationState.addListener(new AnimationStateAdapter());

    return {
        skeleton,
        state: animationState,
        bounds,
        currentAction: {
            animation: "Relax",
            direction: "right",
        },
    };
}

function calculateSetupPoseBounds(skeleton: spine.Skeleton) {
    skeleton.setToSetupPose();
    skeleton.updateWorldTransform();
    const offset = new spine.Vector2();
    const size = new spine.Vector2();
    skeleton.getBounds(offset, size, []);
    return { offset, size };
}

// Mouse position (client, no transform, no supersampling)
let currentMousePos = { x: 0, y: 0 };

function handleMouseMove(event: MouseEvent): void {
    currentMousePos.x = event.clientX;
    currentMousePos.y = event.clientY;
}

function render(): void {
    const now = Date.now() / 1000;
    const delta = now - lastFrameTime;
    lastFrameTime = now;

    // First pass - render to framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const state = character.state;
    const skeleton = character.skeleton;
    
    skeleton.scaleX = character.currentAction.direction === "left" ? -1 : 1;
    
    // Move the canvas when "Move" animation is playing
    if (character.currentAction.animation === "Move" && !isDragging) {
        const moveSpeed = 40; // pixels per second
        const movement = moveSpeed * delta;
        if (character.currentAction.direction === "left") {
            canvas.style.left = (parseFloat(canvas.style.left || "0") - movement) + "px";
            // Turn around when reaching left edge
            if (parseFloat(canvas.style.left) <= 0) {
                canvas.style.left = "0px";
                character.currentAction.direction = "right";
            }
        } else {
            canvas.style.left = (parseFloat(canvas.style.left || "0") + movement) + "px";
            // Turn around when reaching right edge
            if (parseFloat(canvas.style.left) + canvas.width >= window.innerWidth) {
                character.currentAction.direction = "left";
            }
        }
    }
    
    state.update(delta);
    state.apply(skeleton);
    skeleton.updateWorldTransform();

    shader.bind();
    shader.setUniformi(webgl.Shader.SAMPLER, 0);
    shader.setUniform4x4f(webgl.Shader.MVP_MATRIX, mvp.values);

    batcher.begin(shader);
    skeletonRenderer.premultipliedAlpha = false;
    skeletonRenderer.draw(batcher, skeleton);
    batcher.end();

    shader.unbind();

    // Read pixels before second pass to determine if mouse is over character
    const canvasRect = canvas.getBoundingClientRect();
    let pixelX = (currentMousePos.x - canvasRect.x) * SUPERSAMPLE_FACTOR;
    let pixelY = canvas.height - (currentMousePos.y - canvasRect.y) * SUPERSAMPLE_FACTOR;
    let pixelColor = new Uint8Array(4);
    gl.readPixels(
        pixelX, 
        pixelY, 
        1, 1, 
        gl.RGBA, 
        gl.UNSIGNED_BYTE, 
        pixelColor
    );
    const isMouseOver = pixelColor[0] || pixelColor[1] || pixelColor[2] || isDragging;

    // Second pass - render to screen with outline effect
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(outlineShader);

    // Set uniforms
    const uTexture = gl.getUniformLocation(outlineShader, "u_texture");
    const uOutlineColor = gl.getUniformLocation(outlineShader, "u_outlineColor");
    const uOutlineWidth = gl.getUniformLocation(outlineShader, "u_outlineWidth");
    const uTextureSize = gl.getUniformLocation(outlineShader, "u_textureSize");
    const uAlpha = gl.getUniformLocation(outlineShader, "u_alpha");

    gl.uniform1i(uTexture, 0); // Use texture unit 0 for spine character
    gl.uniform4f(uOutlineColor, 1.0, 1.0, 0.0, 1.0); // yellow
    gl.uniform1f(uOutlineWidth, isMouseOver ? 2.0 : 0.0); // Only show outline when mouse is over
    gl.uniform2i(uTextureSize, canvas.width, canvas.height);
    gl.uniform1f(uAlpha, 1.0);

    // Bind framebuffer texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, framebufferTexture);

    // Draw quad
    const aPosition = gl.getAttribLocation(outlineShader, "a_position");
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    if (isMouseOver) {
        // mouse over the character
        canvas.style.pointerEvents = 'auto';
    } else {
        // mouse not over the character
        canvas.style.pointerEvents = 'none';
    }
    requestAnimationFrame(render);
}

function resize(): void {
    // Get the minimum required width and height based on character bounds
    const minWidth = character.bounds.size.x * 2;
    const minHeight = character.bounds.size.y * 1.2;
    
    // Set canvas display size
    canvas.style.width = minWidth / SUPERSAMPLE_FACTOR + "px";
    canvas.style.height = minHeight / SUPERSAMPLE_FACTOR + "px";
    
    // Set canvas internal resolution
    canvas.width = minWidth;
    canvas.height = minHeight;
    
    // Update the projection matrix to match the new resolution
    mvp.ortho2d(0, 0, canvas.width, canvas.height);
    gl.viewport(0, 0, canvas.width, canvas.height);

    // Scale up the skeleton position to match the higher resolution
    character.skeleton.x = canvas.width / 2;
    character.skeleton.y = 0;

    // Update framebuffer texture size
    gl.bindTexture(gl.TEXTURE_2D, framebufferTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
}

function randomPick(probabilities: number[]): number {
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

function turnDirection(current: Direction): Direction {
    return current === "left" ? "right" : "left";
}

function nextAction(current: Action): Action {
    const animeIndex = ANIMATION_NAMES.indexOf(current.animation);
    const nextIndexProb = ANIMATION_MARKOV[animeIndex];
    const nextAnimIndex = randomPick(nextIndexProb);
    const nextAnim = ANIMATION_NAMES[nextAnimIndex];

    let nextDirection = current.direction;
    if (current.animation === "Relax" && nextAnim === "Move") {
        nextDirection = Math.random() < 0.4 ? turnDirection(current.direction) : current.direction;
    }
    return {
        animation: nextAnim,
        direction: nextDirection
    };
}

function handleCanvasClick(): void {
    if (character && character.state) {
        character.currentAction = {
            animation: "Interact",
            direction: character.currentAction.direction
        };
        character.state.setAnimation(0, "Interact", false);
        console.log("Play action", character.currentAction);
    }
}

function handleDragStart(e: MouseEvent): void {
    if (e.button === 0) { // Left click only
        isDragging = true;
        dragStartX = e.clientX;
        canvasStartLeft = parseFloat(canvas.style.left || '0');
        
        // Pause any current animation
        if (character && character.state) {
            character.state.setAnimation(0, "Relax", true);
            character.currentAction = {
                animation: "Relax",
                direction: character.currentAction.direction
            };
        }
    }
}

function handleDrag(e: MouseEvent): void {
    if (isDragging) {
        const deltaX = e.clientX - dragStartX;
        const newLeft = canvasStartLeft + deltaX;
        
        // Constrain to window bounds
        const maxLeft = window.innerWidth - canvas.offsetWidth;
        canvas.style.left = Math.max(0, Math.min(maxLeft, newLeft)) + 'px';
    }
}

function handleDragEnd(): void {
    isDragging = false;
}

window.addEventListener('load', init); 