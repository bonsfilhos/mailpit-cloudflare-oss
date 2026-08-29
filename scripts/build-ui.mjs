import { cp, mkdir, rm } from "node:fs/promises";
import * as esbuild from "esbuild";
import pluginVue from "esbuild-plugin-vue-next";
import { sassPlugin } from "esbuild-sass-plugin";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/assets", { recursive: true });
await cp("public", "dist", { recursive: true });

await esbuild.build({
  entryPoints: ["src/ui/app.js"],
  bundle: true,
  minify: process.env.NODE_ENV === "production",
  sourcemap: process.env.NODE_ENV !== "production",
  define: {
    __VUE_OPTIONS_API__: "true",
    __VUE_PROD_DEVTOOLS__: "false",
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false"
  },
  outfile: "dist/assets/app.js",
  plugins: [
    pluginVue(),
    sassPlugin({ silenceDeprecations: ["import"], quietDeps: true })
  ],
  loader: {
    ".svg": "file",
    ".woff": "file",
    ".woff2": "file",
    ".png": "file"
  },
  assetNames: "assets/[name]-[hash]",
  logLevel: "info"
});
