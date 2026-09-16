import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Apostrophes in prose. The codebase consistently writes them literally,
      // and escaping a handful to satisfy the rule would leave the only three
      // escaped apostrophes in the project. No correctness value here.
      "react/no-unescaped-entities": "off",

      // Both of these are React-compiler rules that misfire on patterns this
      // app uses deliberately, so they warn rather than block:
      //
      //   set-state-in-effect — reading localStorage on mount is how a client
      //     preference is applied without a hydration mismatch. Where
      //     useSyncExternalStore fits it is used instead (Sidebar, TaskList),
      //     but the settings sections genuinely need the mounted guard.
      //
      //   purity — flags `new Date()` inside async Server Components, which
      //     render once per request and are not components in the sense the
      //     rule means.
      //
      // Left visible so genuinely new instances still show up in the output.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
