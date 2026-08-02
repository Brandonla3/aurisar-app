/**
 * RealmFnBlock — custom shader math that compiles on BOTH backends.
 *
 * A NodeMaterialBlock subclass that takes a function body written once in
 * BabylonSL (a GLSL-shaped dialect) and, at build time, runs it through
 * Babylon's own transpiler for whichever language the material is being built
 * for — `state._babylonSLtoWGSL` / `state._babylonSLtoGLSL` — exactly the way
 * stock blocks (WorleyNoise3DBlock, CloudBlock) do.
 *
 * Why not BABYLON.CustomBlock: it emits its source VERBATIM with no language
 * branch, so GLSL written into one compiles on WebGL2 and fails only on
 * WebGPU — the exact remote failure the Realm's dual-backend policy exists to
 * prevent. Its use is banned by boundary.test.js; this block is the sanctioned
 * path.
 *
 * BSL rules the body must follow (from the transpiler's own conversions):
 *  - GLSL-style declarations and types (`float`, `vec2/3/4`, `mat3` ...)
 *  - ternaries must be written BRACKETED: `[cond ? a : b]`
 *  - derivatives (dFdx/dFdy) are converted; loops and helper functions work
 *
 * The private-API dependency is pinned by babylonCapabilities.test.js at the
 * bundle level, and every material built from this block is built under BOTH
 * shader languages in CI (NullEngine generates source without a GPU), so a
 * Babylon rename or a WGSL-only emit error fails a test instead of a player.
 */

/* global BABYLON */

const TYPE_MAP = {
  float: 'Float',
  vec2: 'Vector2',
  vec3: 'Vector3',
  vec4: 'Vector4',
};

function pointType(bslType) {
  const key = TYPE_MAP[bslType];
  if (!key) throw new Error(`[RealmFnBlock] unsupported BSL type "${bslType}"`);
  return BABYLON.NodeMaterialBlockConnectionPointTypes[key];
}

export class RealmFnBlock extends BABYLON.NodeMaterialBlock {
  /**
   * @param {string} name          block instance name (unique per material)
   * @param {object} def
   * @param {string} def.fnName    emitted function name (shared per material —
   *                               two blocks with the same fnName reuse one emit)
   * @param {{name: string, type: string}[]} def.params
   * @param {string} def.returnType  'float' | 'vec2' | 'vec3' | 'vec4'
   * @param {string} def.body      BSL function body, `return`ing returnType
   * @param {string} [def.helpers] optional BSL helper functions emitted before
   */
  constructor(name, { fnName, params, returnType, body, helpers = '' }) {
    super(name, BABYLON.NodeMaterialBlockTargets.Neutral);
    this._fnName = fnName;
    this._params = params;
    this._returnType = returnType;
    this._body = body;
    this._helpers = helpers;
    /** The source actually emitted on the last build — for tests. */
    this._lastEmittedSource = null;

    for (const p of params) this.registerInput(p.name, pointType(p.type));
    this.registerOutput('output', pointType(returnType));
  }

  getClassName() {
    return 'RealmFnBlock';
  }

  get output() {
    return this._outputs[0];
  }

  /** Connection point for a declared param, by name — throws on a typo. */
  input(paramName) {
    const idx = this._params.findIndex((p) => p.name === paramName);
    if (idx === -1) {
      throw new Error(
        `[RealmFnBlock] "${this.name}" has no param "${paramName}". Has: ${this._params.map((p) => p.name).join(', ')}`,
      );
    }
    return this._inputs[idx];
  }

  _buildBlock(state) {
    super._buildBlock(state);

    const paramList = this._params.map((p) => `${p.type} ${p.name}`).join(', ');
    const bsl = `${this._helpers}\n${this._returnType} ${this._fnName}(${paramList})\n{\n${this._body}\n}`;

    // The one branch that matters: same source, per-language emit. WGSL === 1.
    const src = state.shaderLanguage === BABYLON.ShaderLanguage.WGSL
      ? state._babylonSLtoWGSL(bsl)
      : state._babylonSLtoGLSL(bsl);
    this._lastEmittedSource = src;

    state._emitFunction(this._fnName, src, `// RealmFnBlock:${this._fnName}`);

    const args = this._inputs.map((i) => i.associatedVariableName).join(', ');
    state.compilationString +=
      state._declareOutput(this.output) + ` = ${this._fnName}(${args});\n`;

    return this;
  }
}
