# Fluid Dynamics
Fluid Dynamics is a JavaScript library for simulating fluid dynamics and motion of solid objects within the fluid. It uses WebGL shaders to solve Navier-Stokes equations for incompressible flow and is intended to be used in games and for visual effects. 

Library is distributed as the `@bienehito/fluid-dynamics` npm package and through `jsdelivr.net` and `unpkg.com` CDNs. 

## Demo Page: TODO

## Getting Started

```html
<canvas id="canvas" width="800" height="500"></canvas>
<script type="module">
    import { FluidDynamics } from "https://cdn.jsdelivr.net/npm/@bienehito/fluid-dynamics@latest/+esm"
    const canvas = document.getElementById("canvas")
    // Initialize FluidDynamics.
    const fd = new FluidDynamics(canvas, {
        // Set simulation to cover entire canvas. 
        width: canvas.width,
        height: canvas.height,
        // See src/fluid-dynamics.js for all options.
    })
    // Add movement to the fluid by setting liquid x,y velocity to 200,10
    // in a circular area of radius 50 around point 100,80.
    fd.setVelocity(100, 80, 0, 50, 50, 200, 10)
    // Set dye color to red [1,0,0] in the same area.
    fd.setDye(100, 80, 0, 50, 50, [1, 0, 0])
    // Set dye color to blue [0,0,1] to an elipsis centered on 200,80 
    // and angled 60 degrees from horizon with 100 major and 30 minor axes.
    fd.setDye(200, 80, Math.PI / 3, 100, 30, [0, 0, 1])
    // Add a ball at 300, 80 position moving to the left with 100 velocity.
    const ball = {
        position: [300, 80],
        velocity: [-100, 0],
        radius: 20, // Radius of the ball.
        density: 2, // Density will be used to calculate mass of the ball.
    }
    fd.solids.push(ball)
    // Simulation will run automatically. In a few seconds...
    setTimeout(() => {
        // Ball position and velocity is updated by simulation.
        console.log("Ball position:", ball.position, "velocity:", ball.velocity)
        // Simulation can be paused and resumed.
        fd.paused = true
        setTimeout(() => {
            fd.paused = false
            // State of the liquid (velocity, pressure, divergence, curl) can be visualized:
            fd.renderSource = "divergence"
        }, 2000)
    }, 3000)
</script>
```

Besides ESM, you can import library as an UMD module from `https://cdn.jsdelivr.net/npm/@bienehito/fluid-dynamics@latest/dist/fluid-dynamics.umd.js`

## Features
* Clean and simple API.
* Well documented.
* No dependencies.
* Simulates motion of the non-compressible liquid.
* Simulates motion of solid objects suspended in the liquid.
* Exposes position and velocity vectors for simulated solid objects.
* Adjustable simulation parameters (e.g. velocity dissipation).
* Simulation and dye can be scaled down independently to improve performance.
* Coordinates used in API are always screen coordinates (bottom left origin), regardless of simulation and dye scales.
* Simulation can be paused/unpaused.
* Simulation can be placed on any part of a 3d canvas.
* Simulation can auto-update itself or can be manually updated by calling `step(dt)` and `render()` methods.
* Pre- and post-rendering hooks.
* State of the liquid (e.g. velocity, pressure, divergence, curl) can be visualized.
* Average time taken by the simulation step is exposed via the API.

## Limitations
* Requires WebGL2. [^1]
* Borders of the simulation act like solid walls and do not let liquid through. [^1]
* No ability to place walls within the simulation space. [^1]
* Only circular solid objects are supported. [^1]
* Does not simulate rotation of solid objects. [^1]
* Does not visualize solid objects. [^2]
* Does not simulate physics of solid objects (collision, gravity, etc.) other than interaction with the liquid. [^2]

[^1]: Please contact the author if you need this feature.
[^2]: Feature considered out of scope.

## Configuration
All configurations options can be specified via constructor or instance properties:
```
const fd = new FluidDynamics(canvas, {width: 100})
fd.width = 200
```
See [`config`](src/fluid-dynamics.js) for all options.


## Acknowledgements
* https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-38-fast-fluid-dynamics-simulation-gpu
* PavelDoGreat/WebGL-Fluid-Simulation
* transitive-bullshit/react-fluid-animation
* mharrys/fluids-2d

## License
[MIT](./LICENSE)
