import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  { ignores: [".next/**", "node_modules/**", ".scratch/**", "next-env.d.ts"] },
  {
    // App code imports without extensions. Mixing "./types" and "./types.ts" makes the bundler load the module twice,
    // and then `instanceof` checks on errors such as SlotTakenError silently stop matching. Only scripts/ use ".ts".
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: "ImportDeclaration[source.value=/^\\.{1,2}\\/.*\\.tsx?$/]", message: "Import app modules without the .ts extension." },
      ],
    },
  },
];

export default config;
