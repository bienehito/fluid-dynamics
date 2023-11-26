export default /*glsl*/ `
// Fragment shader that draws a gaussian splat ellipsis defined by transform of color at point on uTarget texture.
precision highp float;
precision highp sampler2D;

varying vec2 vUv;
uniform sampler2D uSource;
uniform vec2 point;
uniform mat2 transform;
uniform vec3 color;

void main () {
    vec2 p = transform * (vUv - point.xy);
    float e = exp(-dot(p, p));
    vec3 splat = e * color;
    vec3 base = texture2D(uSource, vUv).xyz;
    gl_FragColor = vec4( base * (1.0-e) + splat, 1.0);
}
`