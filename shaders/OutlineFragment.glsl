precision mediump float;

uniform sampler2D u_texture;    // Character from spine

uniform vec4 u_outlineColor;    // Required: Outline color
uniform float u_outlineWidth;   // Required: Outline width
uniform ivec2 u_textureSize;    // Required: Texture size
uniform float u_alpha;          // Required: Global alpha applied in the end

varying vec2 v_texCoord;

const float c_alphaLv0 = 0.1; // threshold for transparent areas
const float c_alphaLv1 = 0.45; 
const float c_alphaLv2 = 0.9;
const float c_seamCoef = 0.55;
const float c_outlineOverstate = 10.0;

vec4 getOutlined() {
    vec4 texColor = texture2D(u_texture, v_texCoord);
    if (u_outlineWidth > 0.0) {
        vec2 relOutlineWidth = vec2(1.0) / vec2(u_textureSize) * u_outlineWidth;
        
        float kernel[25];
        kernel[0] = 0.0035434; kernel[1] = 0.0158805; kernel[2] = 0.0261825; kernel[3] = 0.0158805; kernel[4] = 0.0035434;
        kernel[5] = 0.0158805; kernel[6] = 0.0711714; kernel[7] = 0.1173418; kernel[8] = 0.0711714; kernel[9] = 0.0158805;
        kernel[10] = 0.0261825; kernel[11] = 0.1173418; kernel[12] = 0.0; kernel[13] = 0.1173418; kernel[14] = 0.0261825;
        kernel[15] = 0.0158805; kernel[16] = 0.0711714; kernel[17] = 0.1173418; kernel[18] = 0.0711714; kernel[19] = 0.0158805;
        kernel[20] = 0.0035434; kernel[21] = 0.0158805; kernel[22] = 0.0261825; kernel[23] = 0.0158805; kernel[24] = 0.0035434;
        
        vec4 sum = vec4(0.0);
        sum += texture2D(u_texture, v_texCoord + vec2(-2, -2) * relOutlineWidth) * kernel[0];
        sum += texture2D(u_texture, v_texCoord + vec2(-1, -2) * relOutlineWidth) * kernel[1];
        sum += texture2D(u_texture, v_texCoord + vec2(0, -2) * relOutlineWidth) * kernel[2];
        sum += texture2D(u_texture, v_texCoord + vec2(1, -2) * relOutlineWidth) * kernel[3];
        sum += texture2D(u_texture, v_texCoord + vec2(2, -2) * relOutlineWidth) * kernel[4];
        sum += texture2D(u_texture, v_texCoord + vec2(-2, -1) * relOutlineWidth) * kernel[5];
        sum += texture2D(u_texture, v_texCoord + vec2(-1, -1) * relOutlineWidth) * kernel[6];
        sum += texture2D(u_texture, v_texCoord + vec2(0, -1) * relOutlineWidth) * kernel[7];
        sum += texture2D(u_texture, v_texCoord + vec2(1, -1) * relOutlineWidth) * kernel[8];
        sum += texture2D(u_texture, v_texCoord + vec2(2, -1) * relOutlineWidth) * kernel[9];
        sum += texture2D(u_texture, v_texCoord + vec2(-2, 0) * relOutlineWidth) * kernel[10];
        sum += texture2D(u_texture, v_texCoord + vec2(-1, 0) * relOutlineWidth) * kernel[11];
        sum += texture2D(u_texture, v_texCoord + vec2(1, 0) * relOutlineWidth) * kernel[13];
        sum += texture2D(u_texture, v_texCoord + vec2(2, 0) * relOutlineWidth) * kernel[14];
        sum += texture2D(u_texture, v_texCoord + vec2(-2, 1) * relOutlineWidth) * kernel[15];
        sum += texture2D(u_texture, v_texCoord + vec2(-1, 1) * relOutlineWidth) * kernel[16];
        sum += texture2D(u_texture, v_texCoord + vec2(0, 1) * relOutlineWidth) * kernel[17];
        sum += texture2D(u_texture, v_texCoord + vec2(1, 1) * relOutlineWidth) * kernel[18];
        sum += texture2D(u_texture, v_texCoord + vec2(2, 1) * relOutlineWidth) * kernel[19];
        sum += texture2D(u_texture, v_texCoord + vec2(-2, 2) * relOutlineWidth) * kernel[20];
        sum += texture2D(u_texture, v_texCoord + vec2(-1, 2) * relOutlineWidth) * kernel[21];
        sum += texture2D(u_texture, v_texCoord + vec2(0, 2) * relOutlineWidth) * kernel[22];
        sum += texture2D(u_texture, v_texCoord + vec2(1, 2) * relOutlineWidth) * kernel[23];
        sum += texture2D(u_texture, v_texCoord + vec2(2, 2) * relOutlineWidth) * kernel[24];
        
        sum *= c_outlineOverstate;
        if (sum.a > c_alphaLv0) {
            texColor.a = min(1.0, sum.a) * u_outlineColor.a;
            texColor.rgb = u_outlineColor.rgb * texColor.a; // premultiplied
        }
    }
    return texColor;
}

vec4 getSeamed() {
    vec4 texColor = texture2D(u_texture, v_texCoord);
    vec2 relPixelSize = vec2(1.0) / vec2(u_textureSize);
    
    vec4 neighbors[24];
    neighbors[0] = texture2D(u_texture, v_texCoord + vec2(-2, -2) * relPixelSize);
    neighbors[1] = texture2D(u_texture, v_texCoord + vec2(-1, -2) * relPixelSize);
    neighbors[2] = texture2D(u_texture, v_texCoord + vec2(0, -2) * relPixelSize);
    neighbors[3] = texture2D(u_texture, v_texCoord + vec2(1, -2) * relPixelSize);
    neighbors[4] = texture2D(u_texture, v_texCoord + vec2(2, -2) * relPixelSize);
    neighbors[5] = texture2D(u_texture, v_texCoord + vec2(-2, -1) * relPixelSize);
    neighbors[6] = texture2D(u_texture, v_texCoord + vec2(-1, -1) * relPixelSize);
    neighbors[7] = texture2D(u_texture, v_texCoord + vec2(0, -1) * relPixelSize);
    neighbors[8] = texture2D(u_texture, v_texCoord + vec2(1, -1) * relPixelSize);
    neighbors[9] = texture2D(u_texture, v_texCoord + vec2(2, -1) * relPixelSize);
    neighbors[10] = texture2D(u_texture, v_texCoord + vec2(-2, 0) * relPixelSize);
    neighbors[11] = texture2D(u_texture, v_texCoord + vec2(-1, 0) * relPixelSize);
    neighbors[12] = texture2D(u_texture, v_texCoord + vec2(1, 0) * relPixelSize);
    neighbors[13] = texture2D(u_texture, v_texCoord + vec2(2, 0) * relPixelSize);
    neighbors[14] = texture2D(u_texture, v_texCoord + vec2(-2, 1) * relPixelSize);
    neighbors[15] = texture2D(u_texture, v_texCoord + vec2(-1, 1) * relPixelSize);
    neighbors[16] = texture2D(u_texture, v_texCoord + vec2(0, 1) * relPixelSize);
    neighbors[17] = texture2D(u_texture, v_texCoord + vec2(1, 1) * relPixelSize);
    neighbors[18] = texture2D(u_texture, v_texCoord + vec2(2, 1) * relPixelSize);
    neighbors[19] = texture2D(u_texture, v_texCoord + vec2(-2, 2) * relPixelSize);
    neighbors[20] = texture2D(u_texture, v_texCoord + vec2(-1, 2) * relPixelSize);
    neighbors[21] = texture2D(u_texture, v_texCoord + vec2(0, 2) * relPixelSize);
    neighbors[22] = texture2D(u_texture, v_texCoord + vec2(1, 2) * relPixelSize);
    neighbors[23] = texture2D(u_texture, v_texCoord + vec2(2, 2) * relPixelSize);

    vec4 sampleColor = vec4(0.0);
    int sampleSize = 0;
    for (int i = 0; i < 24; i++) {
        if (neighbors[i].a > c_alphaLv2) {
            sampleColor += neighbors[i];
            sampleSize++;
        }
    }
    if (sampleSize > 0) {
        texColor.rgb = sampleColor.rgb / float(sampleSize) * c_seamCoef + texColor.rgb * (1.0 - c_seamCoef);
        texColor.a = sampleColor.a / float(sampleSize);
    } else {
        // Premultiplied: raising alpha must raise the color with it, or the pixel darkens
        texColor.rgb *= c_alphaLv2 / texColor.a;
        texColor.a = c_alphaLv2;
    }
    return texColor;
}

void main() {
    vec4 texColor = texture2D(u_texture, v_texCoord);

    if (texColor.a < c_alphaLv0) {
        // Outline effect apply on transparent areas
        texColor = getOutlined();
    } else if (texColor.a < c_alphaLv1) {
        // No effect apply on these areas
    } else if (texColor.a < c_alphaLv2) {
        // Seaming apply on gap areas
        texColor = getSeamed();
    } else {
        // No effect apply on other areas
    }

    // Ultimate composing
    gl_FragColor = texColor;
    gl_FragColor *= u_alpha; // premultiplied
}
