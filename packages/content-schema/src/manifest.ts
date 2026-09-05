import { z } from "zod";

/**
 * Schema for the hand-authored `content/manifest.yaml`.
 *
 * This is the AUTHORING manifest (quotas, packs, review states). The compiled
 * runtime `ContentManifest` of TDD section 12.4 is derived from it by the
 * content compiler and grows in later milestones.
 */
export const authoringManifestSchema = z
  .object({
    draftSchema: z.literal(1),
    contentVersion: z.string().min(1),
    status: z.enum(["outline", "draft", "final"]),
    targets: z.record(
      z.string(),
      z.union([
        z.number().int().nonnegative(),
        z.record(z.string(), z.number().int().nonnegative()),
      ]),
    ),
    packs: z.array(
      z
        .object({
          id: z.string().regex(/^[a-z0-9-]+$/, "pack ids are lower-case kebab-case"),
          status: z.enum(["outline", "draft", "final"]),
          contains: z.record(z.string(), z.number().int().nonnegative()),
        })
        .strict(),
    ),
    reviewStates: z.array(z.string().min(1)).min(1),
  })
  .strict();

export type AuthoringManifest = z.infer<typeof authoringManifestSchema>;
