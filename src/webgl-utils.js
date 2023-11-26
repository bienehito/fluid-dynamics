/** Compiles shader code of type using cache. Returns shader.*/
function compileOnce(gl, code, type, cache) {
	var shader = cache[code]
	if (shader) return shader
	shader = gl.createShader(type);
	gl.shaderSource(shader, code);
	gl.compileShader(shader);
	cache[code] = shader
	return shader
}

/** Map of GL types to method and expected number of arguments. */
var _uniformTypeMeta
function uniformTypeMeta(gl) {
	return _uniformTypeMeta || (_uniformTypeMeta = Object.fromEntries([
		[gl.FLOAT, ["uniform1f", 1]],
		[gl.FLOAT_VEC2, ["uniform2f", 2]],
		[gl.FLOAT_VEC3, ["uniform3f", 3]],
		[gl.FLOAT_VEC4, ["uniform4f", 4]],
		[gl.INT, ["uniform1i", 1]],
		[gl.INT_VEC2, ["uniform2i", 2]],
		[gl.INT_VEC3, ["uniform3i", 3]],
		[gl.INT_VEC4, ["uniform4i", 4]],
		[gl.SAMPLER_2D, ["uniform1i", 1]],
		[gl.FLOAT_MAT2, ["uniformMatrix2fv", 1]],
		[gl.FLOAT_MAT3, ["uniformMatrix3fv", 1]],
		[gl.FLOAT_MAT4, ["uniformMatrix4fv", 1]],
	]))
}

/** Returns dict of program uniforms in the form name:[location,method,numArgs]. */
function getUniforms(gl, program) {
	const typeMetas = uniformTypeMeta(gl)
	let uniforms = {};
	let uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
	for (let i = 0; i < uniformCount; i++) {
		const uniform = gl.getActiveUniform(program, i)
		const typeMeta = typeMetas[uniform.type]
		uniforms[uniform.name] = [gl.getUniformLocation(program, uniform.name), ...typeMeta];
	}
	return uniforms;
}

/** Calls gl.useProgram and sets uniforms. */
function useProgram(gl, program, uniforms) {
	// console.log("Using program " + program.name, uniforms)
	gl.useProgram(program)
	for (let [name, value] of Object.entries(uniforms)) {
		const meta = program.uniforms[name]
		if (!meta) {
			throw `Program ${program.name} does not have ${name} uniform.`
		}
		const [location, method, size] = meta
		if (!Array.isArray(value)) {
			value = [value]
		}
		if (value.length != size) {
			throw `Invalid number of arguments for ${program.name}.${name} uniform. Expected ${size}, got ${value.length}.`
		}
		if (method.indexOf("Matrix") >= 0)
			gl[method].apply(gl, [location, false, ...value])
		else
			gl[method].apply(gl, [location, ...value])
	}
}


/**
 * Compiles list of programs {name: [vsCode, fsCode]}
 * @returns dict of {name:program} gl objects. Each program has extended properties:
 *   name: str program name
 *   uniforms: dict of str uniform name to [location, method, numArgs]
 *   use: method to use program and set uniform values given via {name: value|array} parameter.
  */
export function compilePrograms(gl, programs) {
	const shaderCache = {}
	const compiled = []
	// Compile all shaders first.
	// https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices#compile_shaders_and_link_programs_in_parallel
	for (const [name, [vsCode, fsCode]] of Object.entries(programs)) {
		const prog = gl.createProgram()
		const vs = compileOnce(gl, vsCode, gl.VERTEX_SHADER, shaderCache)
		const fs = compileOnce(gl, fsCode, gl.FRAGMENT_SHADER, shaderCache)
		gl.attachShader(prog, vs);
		gl.attachShader(prog, fs);
		compiled.push([name, prog, vs, fs])

	}
	// Link all programs.
	for (const [_, prog] of compiled) {
		gl.linkProgram(prog);
	}
	// Check for errors and add extended properties.
	const res = {}
	for (const [name, prog, vs, fs] of compiled) {
		if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
			console.error(`Link failed for ${name}: ${gl.getProgramInfoLog(prog)}`);
			console.error(`vs info-log: ${gl.getShaderInfoLog(vs)}`);
			console.error(`fs info-log: ${gl.getShaderInfoLog(fs)}`);
		} else {
			prog.name = name
			prog.uniforms = getUniforms(gl, prog)
			prog.use = vals => useProgram(gl, prog, vals)
			res[name] = prog
		}
	}
	return res
}


/** Creates VAO for 2D mesh specified with vertices and elements. */
export function vertexArrayObject2D(gl, vertices, elements) {
	const vao = gl.createVertexArray()
	gl.bindVertexArray(vao)
	gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW)
	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer())
	gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(elements), gl.STATIC_DRAW)
	gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
	gl.enableVertexAttribArray(0)
	gl.bindVertexArray(null);
	gl.bindBuffer(gl.ARRAY_BUFFER, null)
	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null)
	return vao
}


/** Creates frame buffer attached texture object.*/
export function createTextureFBO(gl, w, h, internalFormat, format, type, filter) {
	gl.activeTexture(gl.TEXTURE0);
	let texture = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);

	let fbo = gl.createFramebuffer();
	gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
	gl.viewport(0, 0, w, h);
	gl.clear(gl.COLOR_BUFFER_BIT);
	gl.bindFramebuffer(gl.FRAMEBUFFER, null)

	return {
		texture,
		fbo,
		width: w,
		height: h,
		texelSize: [1.0 / w, 1.0 / h],
		/** Attaches texture to texture unit id.*/
		attach(id) {
			gl.activeTexture(gl.TEXTURE0 + id);
			gl.bindTexture(gl.TEXTURE_2D, texture);
			return id;
		},
		delete() {
			gl.deleteTexture(texture);
			gl.deleteFramebuffer(fbo);
		}
	};
}

/** Creates double frame buffer attached texture object. */
export function createDoubleTextureFBO(gl, w, h, internalFormat, format, type, filter) {
	let fbo1 = createTextureFBO(gl, w, h, internalFormat, format, type, filter);
	let fbo2 = createTextureFBO(gl, w, h, internalFormat, format, type, filter);
	return {
		w: w,
		h: h,
		texelSize: fbo1.texelSize,
		get read() {
			return fbo1
		},
		get write() {
			return fbo2
		},
		swap() {
			let temp = fbo1;
			fbo1 = fbo2;
			fbo2 = temp;
		},
		delete() {
			fbo1.delete()
			fbo2.delete()
		}
	}
}

const uInt32Val = new Uint32Array([0])
const float32Val = new Float32Array(uInt32Val.buffer)

/** Converts float-16 (half-float) represented as an uint-16 to float-32. */
export function uInt16ToFloat32(hf) {
	let f = (hf & 0x8000) << 16; // start with sign bit.
	const expo = (hf & 0x7C00) >> 10;
	if (expo === 0) {
		// Subnormal float16 number: (0.frac) * 2^(exp-14)
		const frac = hf & 0x03FF;
		// If frac is 0 then value is 0.
		if (frac !== 0) {
			// Convert to normal float32 number.
			// Shift frac by 13 and extra until leading 0.
			// for example subnormal 0.0111 will become normal 1.11
			const extra = Math.clz32(frac) - 21;
			f |= ((113 - extra) << 23) | ((hf & 0x01FF) << (13 + extra));
		}
	} else if (expo < 31) {
		// Normal float16 number: (1.frac) * 2^(exp-15)
		// Convert to normal float32 number: (1.frac) * 2^(exp-127)
		// float32 exp starts at bit 23
		// float32 exp offset: 127, float16: 15. delta: 112
		// float16 fraction bits: 10, float32: 23. delta: 13
		f |= ((expo + 112) << 23) | ((hf & 0x03FF) << 13);
	} else {
		// Infinity and NaN
		f |= 0x7F800000 | ((hf & 0x03FF) << 13);
	}
	uInt32Val[0] = f
	return float32Val[0]
}

// TODO: move these to tests, create test npm command.
// _uInt16ToFloat32Tests()
function _uInt16ToFloat32Tests() {
	// From https://en.wikipedia.org/wiki/Half-precision_floating-point_format
	const tests = [
		[0x0000, 0],
		[0x0001, 5.960464477539063e-8],
		[0x03ff, 0.00006097555160522461],
		[0x0400, 0.00006103515625],
		[0x3555, 0.333251953125],
		[0x3bff, 0.99951171875],
		[0x3c00, 1],
		[0x3c01, 1.0009765625],
		[0x7bff, 65504],
		[0x7c00, Infinity],
		[0x8000, -0],
		[0xc000, -2],
		[0xfc00, -Infinity]]

	for (let [uInt16, expected] of tests) {
		const actual = uInt16ToFloat32(uInt16)
		// const actual = halfFloatToFloat(uInt16)
		if (expected != actual) {
			console.log(`Test failed for ${uInt16.toString(16)}. Expected ${expected}, got ${actual}`)
		}
	}
}
