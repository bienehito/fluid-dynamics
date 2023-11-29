import path from "path"
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default {
    entry: './src/index.js',
    mode: 'production',
    devtool: 'source-map',
    output: {
        filename: 'fluid-dynamics.umd.js',
        path: path.resolve(__dirname, 'dist'),
        library: {
            name: "fluidDynamics",
            type: 'umd',
        }
    },
}
