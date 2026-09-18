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

      // Underscore-prefixed bindings are deliberate discards, not oversights.
      //
      // The pattern they exist for is stripping fields by destructuring —
      // `const { id: _id, created_at: _c, ...shape } = row` in duplicateTask —
      // where spreading the rest means a column added later is carried over
      // automatically. Listing the kept fields by hand instead is how
      // weekly_target got missed the one time someone tried.
      //
      // Only the discard side is exempted. A genuinely unused import or
      // variable still warns, which is how twelve dead ones were found the day
      // this was added.
      "@typescript-eslint/no-unused-vars": ["warn", {
        varsIgnorePattern:       "^_",
        argsIgnorePattern:       "^_",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
        ignoreRestSiblings:      true,
      }],

      // Both React-compiler rules are errors, with their handful of real
      // exceptions disabled inline and explained at the site.
      //
      // They were warnings while eight and two instances were outstanding,
      // which meant they blocked nothing and were read by nobody. Every
      // instance is now either fixed or justified, so the rules can do the job
      // they were added for: catching the next one.
      //
      //   set-state-in-effect — the common case was reading localStorage on
      //     mount to apply a client preference. `src/lib/use-stored.ts` does
      //     that properly. What is left disabled is state reset when a prop
      //     changes, which is a different thing the rule cannot distinguish.
      //
      //   purity — `Date.now()` in an async Server Component renders once per
      //     request and is fine; the same call in a client component during
      //     render is a genuine hydration bug.
      "react-hooks/set-state-in-effect": "error",
      "react-hooks/purity": "error",
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
