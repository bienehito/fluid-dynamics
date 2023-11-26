export default /*glsl*/ `
// Fragment shader that draws a filled hard-border ellipsis defined by transform of color at point on uSource
precision highp float;
precision highp sampler2D;

varying vec2 vUv;
uniform vec2 point;
uniform mat2 transform;
uniform vec3 color;
uniform sampler2D uSource;

void main () {
    vec2 p = transform * (vUv - point.xy);
    gl_FragColor = vec4(length(p) < 1.0 
        ? vec4(color, 1.0) 
        : texture2D(uSource, vUv));
}
`