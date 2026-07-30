/**
 * Code Guide:
 * ESLint configuration for the repository.
 * It defines static-analysis rules that keep the codebase consistent and catch common mistakes early.
 */

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Controllers (src/app/**) must go through a domain's Service, not call its
  // Repository directly — Repository is data-access only and has no business
  // rules, caching, or validation. Type-only imports (e.g. sort-key unions) are
  // still allowed since they carry no runtime coupling to the repository object.
  {
    files: ["src/app/**/*.ts", "src/app/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/*/repository"],
              allowTypeImports: true,
              message:
                'Controllers must call the domain\'s Service ("@/lib/<domain>/service"), not Repository directly.',
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
