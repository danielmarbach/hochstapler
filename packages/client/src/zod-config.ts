// zod must not probe `new Function` (JIT): under our CSP (no unsafe-eval) the probe is reported as a violation.
// Imported first in main.tsx so the flag is set before any schema parses (docs/DESIGN.md #46).
import { z } from "zod";

z.config({ jitless: true });
