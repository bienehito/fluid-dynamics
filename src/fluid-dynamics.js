import advectionCode from "./shaders/advection.js"
import curlShaderCode from "./shaders/curl.js"
import divergenceShaderCode from "./shaders/divergence.js"
import ellipsisShaderCode from "./shaders/ellipsis.js"
import gradientSubtractShaderCode from "./shaders/gradient-subtract.js"
import pressureShaderCode from "./shaders/pressure.js"
import splatShaderCode from "./shaders/splat.js"
import transformShaderCode from "./shaders/transform.js"
import vertexShaderCode from "./shaders/vertex.js"
import vorticityShaderCode from "./shaders/vorticity.js"
import { compilePrograms, createDoubleTextureFBO, createTextureFBO, vertexArrayObject2D, uInt16ToFloat32 } from "./webgl-utils.js"

const config = {
	// Position on canvas to render simulation at.
	bottom: 0,
	left: 0,
	// Size of the simulation window.
	width: 100,
	height: 100,
	// Value to scale width and height by for resolution of simulation and dye.
	// Set these values to <1 to improve performance. The simulation shaders are executed
	// 5+pressureIterations times every update, while dye shaders are executed 2 times 
	// every update, so lowering simScale has greater effect on performance.
	simScale: 1,
	dyeScale: 1,
	// Simulation is paused.
	paused: false,
	// Percent of velocity dissipated per second via exponential decay.
	velocityDissipation: 0.1,
	// Percent of dye intensity dissipated per second via exponential decay.
	dyeDissipation: 0.1,
	// Percent of pressure dissipated per second. Increase to reduce effect of pressure waves. 
	pressureDissipation: 0,
	// Maximum interval in seconds between simulation updates to avoid instability.
	maxSimulationStep: 1 / 20,
	// Number of iterations in pressure computation. Higher number increases speed of pressure waves.
	pressureIterations: 20,
	// Amount of curl/vorticity to add to velocity.
	curl: 3,
	// What to render: dye, velocity, pressure, divergence, curl, solid.
	renderSource: "dye",
	// Matrix to transform renderSource by. Must be either a scalar, or a Float32Array with column-major matrix4.
	// renderTransform: { velocity: 0.01, pressure: rToRG(0.01), divergence: rToRG(1), curl: rToRG(0.1), solid: 0.1 }
	renderTransforms: { velocity: 0.01, pressure: 0.01, divergence: 1, curl: 0.1, solid: 0.1 },
	// Pre/post render callbacks: function(dt), where dt is time delta in seconds.
	preRender: null,
	postRender: null,
	// Whether to run update() automatically using requestAnimationFrame.
	autoUpdate: true,
	// Alpha value used in calculation of exponentially smoothed _update() run time.
	updateTimeAlpha: 1 / 120
}

/** Fluid dynamics and solid object simulation. */
export default class FluidDynanmics {

	/** Constructor taking WebGL2RenderingContext context and options - see config above for defaults. */
	constructor(gl, opts) {
		if (!(gl instanceof WebGL2RenderingContext)) throw "webgl2 is required"
		gl.getExtension('EXT_color_buffer_float');

		Object.assign(this, config, opts)
		Object.assign(this.renderTransforms, config.renderTransforms, opts.renderTransforms || {})

		this._gl = gl
		this._aspectRatio = this._width / this._height
		this._programs = compilePrograms(gl, {
			advection: [vertexShaderCode, advectionCode],
			curl: [vertexShaderCode, curlShaderCode],
			divergence: [vertexShaderCode, divergenceShaderCode],
			ellipsis: [vertexShaderCode, ellipsisShaderCode],
			gradientSubtract: [vertexShaderCode, gradientSubtractShaderCode],
			pressure: [vertexShaderCode, pressureShaderCode],
			transform: [vertexShaderCode, transformShaderCode],
			splat: [vertexShaderCode, splatShaderCode],
			vorticity: [vertexShaderCode, vorticityShaderCode],
		})

		this._init_vao()
		if (this.autoUpdate)
			requestAnimationFrame(this._update.bind(this))
	}

	/** Resizes framebuffers and adjusts solids velocity/position if simulation size changed. */
	_resizeIfNeeded() {
		if (this._width != this.width || this._height != this.height ||
			this._simScale != this.simScale ||
			this._dyeScale != this.dyeScale) {
			this._resizeBuffers(true)
			// Move and update solids velocity.
			if (this._width) {
				var scale = [this.width / this._width, this.height / this._height]
				for (let solid of this.solids) {
					for (let i = 0; i < 2; i++) {
						solid.position[i] *= scale[i]
						solid.velocity[i] *= scale[i]
					}
				}
			}
			// Update state with new values.
			this._width = this.width
			this._height = this.height
			this._aspectRatio = this._width / this._height
			this._simScale = this.simScale
			this._dyeScale = this.dyeScale
		}
	}

	/** Creates or resizes simulation buffers. */
	_resizeBuffers(copyData) {
		const gl = this._gl
		const simWidth = this.width * this.simScale
		const simHeight = this.height * this.simScale
		const dyeWidth = this.width * this.dyeScale
		const dyeHeight = this.height * this.dyeScale
		const stateBuffers = ["_dye", "_velocity", "_pressure"]
		const oldBuffers = this._dye && copyData
			? Object.fromEntries(stateBuffers.map(name => [name, this[name]]))
			: []
		// Create buffers.
		this._dye = createDoubleTextureFBO(gl, dyeWidth, dyeHeight, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR)
		this._velocity = createDoubleTextureFBO(gl, simWidth, simHeight, gl.RG16F, gl.RG, gl.HALF_FLOAT, gl.LINEAR)
		this._pressure = createDoubleTextureFBO(gl, simWidth, simHeight, gl.R16F, gl.RED, gl.HALF_FLOAT, gl.NEAREST)
		this._divergence = createTextureFBO(gl, simWidth, simHeight, gl.R16F, gl.RED, gl.HALF_FLOAT, gl.NEAREST)
		this._curl = createTextureFBO(gl, simWidth, simHeight, gl.R16F, gl.RED, gl.HALF_FLOAT, gl.NEAREST)
		// Copy data from old buffers.
		for (let [name, oldBuffer] of Object.entries(oldBuffers)) {
			const transform = name == "_velocity"
				? identityMatrix4(simWidth / oldBuffer.w, simHeight / oldBuffer.h)
				: identityMatrix4()
			this._programs.transform.use({ value: transform, uTexture: oldBuffer.read.attach(0) })
			this._blit(this[name].write)
			this[name].swap();
			oldBuffer.delete()
		}
	}


	/** Create and initialize a 2d vector array object containing two rectangles making up a [-1,1] square. */
	_init_vao() {
		this._vao = vertexArrayObject2D(this._gl, [-1, -1, -1, 1, 1, 1, 1, -1], [0, 1, 2, 0, 2, 3])
	}

	/** Renders current programs to target using _vao as an input.*/
	_blit(target) {
		const gl = this._gl
		const fbo = target && target.fbo
		if (target) {
			gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
			gl.viewport(0, 0, target.width, target.height);
		} else {
			gl.bindFramebuffer(gl.FRAMEBUFFER, null)
			gl.viewport(this.left, this.bottom, this._width, this._height);
		}
		gl.bindVertexArray(this._vao)
		gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0)
	}

	/**
	 * Sets liquid velocity in dx, dy direction at x, y position in a gaussian splot of radius.
	 * All dimensions are in screen pixels.
	 */
	setVelocity(x, y, angle, majorSize, minorSize, dx, dy) {
		this._programs.splat.use({
			uSource: this._velocity.read.attach(0),
			point: [x / this._width, y / this._height],
			color: [dx * this._simScale, dy * this._simScale, 0],
			transform: splatTransform(-angle, majorSize, minorSize, this._width, this._height)
		})
		this._blit(this._velocity.write)
		this._velocity.swap()
	}

	/** 
	 * Sets dye color in a gaussian splat of radius at x, y position.
	 * color is a [r,g,b] in 0..1 range or random will be used if none is provided.
	 * All dimensions are in screen pixels.
	*/
	setDye(x, y, angle, majorSize, minorSize, color) {
		if (!color) color = HSVtoRGB(Math.random(), 1.0, 1.0)
		this._programs.splat.use({
			uSource: this._dye.read.attach(0),
			point: [x / this._width, y / this._height],
			color: color.map(v => v * 2.72),
			transform: splatTransform(-angle, majorSize, minorSize, this._width, this._height)
		})
		this._blit(this._dye.write)
		this._dye.swap()
	}

	/** Resets simulation. */
	reset() {
		this._resizeBuffers(false)
	}

	/** 
	 * Solid circular-shaped objects to simulate.
	 * Each object is expected to have following properties:
	 *    position: [x,y] - center of object
	 *    velocity: [x,y] - velocity of the object
	 *    radius: radius of the object
	 *    density: (optional) density of the object
	 *    mass: (optional) mass of the object, takes precedence over density. 
	 * All dimensions are in screen pixels.
	 * Simulation will update position and velocity based on fluid movement.
	 */
	solids = []

	/** Exponentially smoothed run time of _update() method in seconds. */
	updateTime = 0

	/** Update function runs on every animation frame.*/
	_update() {
		// Timedelta since last update.
		const now = Date.now();
		const dt = Math.min(this._now ? (now - this._now) / 1000 : 1, this.maxSimulationStep)
		this._now = now
		this._resizeIfNeeded()
		// Update simulation.
		if (!this.paused)
			this.step(dt)
		// Render.
		if (this.preRender) this.preRender(dt)
		this.render()
		if (this.postRender) this.postRender(dt)
		// Schedule another update.
		if (this.autoUpdate)
			requestAnimationFrame(this._update.bind(this))
		this.updateTime = ((Date.now() - now) / 1000) * this.updateTimeAlpha +
			this.updateTime * (1 - this.updateTimeAlpha)
	}

	/** 
	 * Updates simulation after a passage of dt seconds.
	 * For details, see https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-38-fast-fluid-dynamics-simulation-gpu
	*/
	step(dt) {
		const gl = this._gl
		gl.disable(gl.BLEND);

		// Calculate curl/rotor of velocity.
		this._programs.curl.use({
			uVelocity: this._velocity.read.attach(0),
			texelSize: this._velocity.texelSize
		});
		this._blit(this._curl);

		// Add vorticity force to velocity.
		this._programs.vorticity.use({
			uVelocity: this._velocity.read.attach(0),
			uCurl: this._curl.attach(1),
			texelSize: this._velocity.texelSize,
			curl: this.curl,
			dt: dt,
		})
		this._blit(this._velocity.write);
		this._velocity.swap();

		// Calculate velocity divergence.
		this._programs.divergence.use({
			uVelocity: this._velocity.read.attach(0),
			texelSize: this._velocity.texelSize,
		})
		this._blit(this._divergence);

		// Dissipate pressure.
		if (this.pressureDissipation) {
			this._programs.transform.use({
				uTexture: this._pressure.read.attach(0),
				value: identityMatrix4(1.0 - this.pressureDissipation * dt)
			})
			this._blit(this._pressure.write)
			this._pressure.swap()
		}

		// Iteratively calculate pressure from divergence.
		this._programs.pressure.use({
			uDivergence: this._divergence.attach(0),
			texelSize: this._velocity.texelSize,
		})
		for (let i = 0; i < this.pressureIterations; i++) {
			gl.uniform1i(this._programs.pressure.uniforms.uPressure[0], this._pressure.read.attach(1));
			this._blit(this._pressure.write);
			this._pressure.swap();
		}

		// Apply pressure gradient to velocity.
		this._programs.gradientSubtract.use({
			uPressure: this._pressure.read.attach(0),
			uVelocity: this._velocity.read.attach(1),
			texelSize: this._velocity.texelSize,
		})
		this._blit(this._velocity.write);
		this._velocity.swap();

		// Advect (move) velocity.
		const velocityId = this._velocity.read.attach(0);
		this._programs.advection.use({
			uVelocity: velocityId,
			uSource: velocityId,
			texelSize: this._velocity.texelSize,
			dt: dt,
			scale: 1.0 - this.velocityDissipation * dt,
		})
		this._blit(this._velocity.write);
		this._velocity.swap();

		// Advect dye.
		this._programs.advection.use({
			uSource: this._dye.read.attach(1),
			scale: 1.0 - this.dyeDissipation * dt
		})
		this._blit(this._dye.write);
		this._dye.swap();

		// Update solid object positions
		this._updateSolids(dt);
	}

	/** Draws solid shape on target with color. */
	_drawSolid(solid, target, color) {
		this._programs.ellipsis.use({
			point: [solid.position[0] / this._width, solid.position[1] / this._height],
			color: color,
			uSource: target.read.attach(0),
			transform: splatTransform(0, solid.radius, solid.radius, this._width, this._height)
		})
		this._blit(target.write)
		target.swap()
	}

	/** Update position and velocity of solid objects. */
	_updateSolids(dt) {
		const gl = this._gl
		for (let solid of this.solids) {
			// Read presure.
			gl.bindFramebuffer(gl.FRAMEBUFFER, this._pressure.read.fbo);
			const left = Math.floor((solid.position[0] - solid.radius) * this.simScale) - 1,
				bottom = Math.floor((solid.position[1] - solid.radius) * this.simScale) - 1,
				sampleSize = Math.floor(solid.radius * this.simScale) * 2 + 2,
				pressure = new Uint16Array(sampleSize * sampleSize)
			gl.readPixels(left, bottom, sampleSize, sampleSize, gl.RED, gl.HALF_FLOAT, pressure)
			// Compute pressure gradient around the solid.
			let dx = 0, dy = 0, steps = 20, step = Math.PI * 2 / steps,
				c = sampleSize / 2, r = (sampleSize - 1) / 2
			for (let a = 0; a < Math.PI * 2; a += step) {
				const cos = Math.cos(a), sin = Math.sin(a),
					px = Math.floor(c + r * cos),
					py = Math.floor(c + r * sin),
					p = uInt16ToFloat32(pressure[px + py * sampleSize])
				dx += p * cos
				dy += p * sin
			}
			// force(a) = p(a)*area = p(a)*r*step. forceX(a) = p(a)*r*step*cos(a)
			// Integral of force projected to x and y.
			const pForce = [-dx * r * step, -dy * r * step],
				mass = solid.mass || ((solid.density || 1) * Math.PI * r * r)
			// Apply force and adjust position.
			for (let i = 0; i < 2; i++) {
				solid.velocity[i] += pForce[i] / mass //* dt
				solid.position[i] += solid.velocity[i] * dt
			}
			// Draw solid in the new location.
			this._drawSolid(solid, this._velocity,
				[solid.velocity[0] * this._simScale, solid.velocity[1] * this._simScale, 0])
		}
	}

	/** Default transforms applied to buffers to produce color rendered on screen. */
	_defaultRenderTransforms = {
		dye: identityTransform,
		velocity: identityTransform,
		pressure: rToRG,
		divergence: rToRG,
		curl: rToRG,
		solid: identityTransform,
	}

	/** Renders renderSource buffer to screen. */
	render() {
		const gl = this._gl
		let source = this["_" + this.renderSource]
		if (!source) throw `Can't find ${this.renderSource} render source.`
		if (source.read) source = source.read
		var transform = this.renderTransforms[this.renderSource] || 1
		if (!(transform instanceof Float32Array))
			transform = this._defaultRenderTransforms[this.renderSource](transform)
		this._programs.transform.use({
			uTexture: source.attach(0),
			value: transform
		})
		this._blit(null)
	}
}

/** Converts hsv color to rgb. All values are in 0..1 range. */
function HSVtoRGB(h, s, v) {
	let r, g, b, i, f, p, q, t;
	i = Math.floor(h * 6);
	f = h * 6 - i;
	p = v * (1 - s);
	q = v * (1 - f * s);
	t = v * (1 - (1 - f) * s);
	switch (i % 6) {
		case 0: r = v, g = t, b = p; break;
		case 1: r = q, g = v, b = p; break;
		case 2: r = p, g = v, b = t; break;
		case 3: r = p, g = q, b = v; break;
		case 4: r = t, g = p, b = v; break;
		case 5: r = v, g = p, b = q; break;
	}
	return [r, g, b]
}

/** A scaled identify matrix. */
function identityMatrix4(s1, s2, s3, s4) {
	if (s1 == undefined) s1 = 1
	if (s2 == undefined) s2 = 1
	if (s3 == undefined) s3 = 1
	if (s4 == undefined) s4 = 1
	return new Float32Array([
		s1, 0, 0, 0,
		0, s2, 0, 0,
		0, 0, s3, 0,
		0, 0, 0, s4
	])
}

/** Identify render transform matrix. */
function identityTransform(s) {
	return identityMatrix4(s, s, s, 1)
}

/** Render transform matrix that sets green channel to -red channel. */
function rToRG(s) {
	return new Float32Array([
		s, -s, 0, 0,
		0, 0, 0, 0,
		0, 0, 0, 0,
		0, 0, 0, 1
	])
}

/** Transform matrix from ellipsoid to a circle with radius 1. */
function splatTransform(angle, majorSize, minorSize, width, height) {
	const cos = Math.cos(angle), sin = Math.sin(angle)
	return new Float32Array([
		width / majorSize * cos, width / minorSize * sin,
		- height / majorSize * sin, height / minorSize * cos
	])
}
