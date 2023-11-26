export default /*glsl*/ `
// Fragment shader that applies transform matrix to uTexture.
precision mediump float;
precision mediump sampler2D;

varying highp vec2 vUv;
uniform sampler2D uTexture;
uniform mat4 value;

void main () {
    gl_FragColor = value * texture2D(uTexture, vUv);
}
`