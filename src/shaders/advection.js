export default /*glsl*/ `
// Fragment shader that transports uSource value alongside the uVelocity vector and scales it.
precision highp float;
precision highp sampler2D;

varying vec2 vUv;
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 texelSize;
uniform float dt;
uniform float scale;

void main () {
    vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
    gl_FragColor = scale * texture2D(uSource, coord);
    gl_FragColor.a = 1.0;
}
`