import { z } from "zod";

import type { ContentId } from "./content-id.ts";

export const ASSET_KINDS = [
  "portrait",
  "facility",
  "icon",
  "event-card",
  "campus",
  "ui",
] as const;

export const ASSET_SCALE_POLICIES = [
  "integer-pixel",
  "contain",
  "cover",
  "native",
] as const;

export const PORTRAIT_FICTIONALISATION_STATUSES = [
  "fictionalized-real-person",
  "fictional-person",
  "institutional-composite",
] as const;

const authoredAccessibilitySchema = z.discriminatedUnion("decorative", [
  z.object({ decorative: z.literal(true) }).strict(),
  z
    .object({
      decorative: z.literal(false),
      altText: z.string().trim().min(1),
    })
    .strict(),
]);

const authoredPortraitMetadataSchema = z
  .object({
    subjectId: z.string().trim().min(1),
    fictionalisationStatus: z.enum(PORTRAIT_FICTIONALISATION_STATUSES),
  })
  .strict();

export const authoredAssetDefinitionSchema = z
  .object({
    id: z.string().trim().min(1),
    kind: z.enum(ASSET_KINDS),
    sourcePath: z.string().trim().min(1),
    pixelDimensions: z
      .object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      })
      .strict(),
    scalePolicy: z.enum(ASSET_SCALE_POLICIES),
    accessibility: authoredAccessibilitySchema,
    rights: z
      .object({
        copyrightHolder: z.string().trim().min(1),
        licence: z.string().trim().min(1),
        sourceUrl: z.string().url().optional(),
        sourceNotes: z.array(z.string().trim().min(1)).min(1),
      })
      .strict(),
    portrait: authoredPortraitMetadataSchema.optional(),
  })
  .strict()
  .superRefine((definition, context) => {
    if (definition.kind === "portrait" && definition.portrait === undefined) {
      context.addIssue({
        code: "custom",
        path: ["portrait"],
        message: "portrait assets require subject and fictionalisation metadata",
      });
    }
    if (definition.kind !== "portrait" && definition.portrait !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["portrait"],
        message: "portrait metadata is only valid for portrait assets",
      });
    }
  });

export const assetManifestFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    status: z.enum(["draft", "final"]),
    assets: z.array(authoredAssetDefinitionSchema),
  })
  .strict();

export type AuthoredAssetDefinition = z.infer<typeof authoredAssetDefinitionSchema>;
export type AssetManifestFile = z.infer<typeof assetManifestFileSchema>;
export type AssetKind = (typeof ASSET_KINDS)[number];
export type AssetScalePolicy = (typeof ASSET_SCALE_POLICIES)[number];
export type PortraitFictionalisationStatus =
  (typeof PORTRAIT_FICTIONALISATION_STATUSES)[number];

export type AssetAccessibility =
  | { readonly decorative: true }
  | { readonly decorative: false; readonly altText: string };

export interface AssetDefinition {
  readonly id: ContentId;
  readonly kind: AssetKind;
  /** Repository-relative POSIX path to the source file. */
  readonly sourcePath: string;
  readonly sourceSha256: string;
  readonly mediaType: "image/png" | "image/webp" | "image/svg+xml" | "image/gif";
  readonly pixelDimensions: {
    readonly width: number;
    readonly height: number;
  };
  readonly scalePolicy: AssetScalePolicy;
  readonly accessibility: AssetAccessibility;
  readonly rights: {
    readonly copyrightHolder: string;
    readonly licence: string;
    readonly sourceUrl?: string;
    readonly sourceNotes: readonly string[];
  };
  readonly portrait?: {
    readonly subjectId: ContentId;
    readonly fictionalisationStatus: PortraitFictionalisationStatus;
  };
}

export interface AssetCatalogueDefinition {
  readonly status: "draft" | "final";
  readonly definitions: Readonly<Record<string, AssetDefinition>>;
  readonly orderedIds: readonly ContentId[];
}

const canonicalIdSchema = z
  .string()
  .regex(/^[a-z0-9-]+:[a-z0-9._-]+$/, "expected a canonical content ID");

const compiledAssetDefinitionSchema = z
  .object({
    id: canonicalIdSchema,
    kind: z.enum(ASSET_KINDS),
    sourcePath: z.string().min(1),
    sourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
    mediaType: z.enum(["image/png", "image/webp", "image/svg+xml", "image/gif"]),
    pixelDimensions: z
      .object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      })
      .strict(),
    scalePolicy: z.enum(ASSET_SCALE_POLICIES),
    accessibility: authoredAccessibilitySchema,
    rights: z
      .object({
        copyrightHolder: z.string().min(1),
        licence: z.string().min(1),
        sourceUrl: z.string().url().optional(),
        sourceNotes: z.array(z.string().min(1)).min(1),
      })
      .strict(),
    portrait: z
      .object({
        subjectId: canonicalIdSchema,
        fictionalisationStatus: z.enum(PORTRAIT_FICTIONALISATION_STATUSES),
      })
      .strict()
      .optional(),
  })
  .strict();

export const assetCatalogueDefinitionSchema = z
  .object({
    status: z.enum(["draft", "final"]),
    definitions: z.record(z.string(), compiledAssetDefinitionSchema),
    orderedIds: z.array(canonicalIdSchema),
  })
  .strict();
