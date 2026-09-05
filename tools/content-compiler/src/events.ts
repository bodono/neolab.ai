import { join } from "node:path";

import {
  copyCatalogueDefinitionSchema,
  eventDefinitionSchema,
  type ContentId,
  type CopyCatalogueDefinition,
  type EventCatalogueDefinition,
  type EventDefinition,
} from "@neolab/content-schema";
import { z } from "zod";

import { ContentFileError, parseYamlFile } from "./yaml-io.ts";

/**
 * Authored decision events and their player-facing copy.
 *
 * Authored files use draft IDs (`event.government.reporting-request`); this
 * module canonicalises them before validating against the compiled event
 * schema, so there is exactly one schema of record for event shape.
 */

const authoredEventFileSchema = z
  .object({
    draftSchema: z.literal(1),
    contentType: z.literal("decision-events"),
    pack: z.string().min(1),
    events: z.array(z.record(z.string(), z.unknown())).min(1),
  })
  .strict();

const copyFileSchema = z
  .object({
    draftSchema: z.literal(1),
    contentType: z.literal("copy-catalogue"),
    locale: z.string().min(1),
    messages: z.record(z.string(), z.string().min(1)),
  })
  .strict();

function draftEventId(value: unknown, filePath: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ContentFileError(filePath, undefined, undefined, "event is missing an id");
  }
  return value;
}

export function compileCopyCatalogue(contentDir: string): CopyCatalogueDefinition {
  const copyPath = join(contentDir, "copy", "en-GB.yaml");
  const raw = parseYamlFile(copyPath);
  const parsed = copyFileSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ContentFileError(
      copyPath,
      undefined,
      undefined,
      issue === undefined
        ? "invalid copy catalogue"
        : `${issue.path.join(".")}: ${issue.message}`,
    );
  }
  return copyCatalogueDefinitionSchema.parse({
    locale: parsed.data.locale,
    messages: parsed.data.messages,
  });
}

export function compileEventCatalogue(
  contentDir: string,
  eventFiles: readonly string[],
  canonicalise: (draft: string, filePath: string) => ContentId,
): EventCatalogueDefinition {
  const definitions: Record<string, EventDefinition> = {};
  for (const fileName of eventFiles) {
    const eventPath = join(contentDir, "events", fileName);
    const raw = parseYamlFile(eventPath);
    const file = authoredEventFileSchema.safeParse(raw);
    if (!file.success) {
      const issue = file.error.issues[0];
      throw new ContentFileError(
        eventPath,
        undefined,
        undefined,
        issue === undefined
          ? "invalid event file"
          : `${issue.path.join(".")}: ${issue.message}`,
      );
    }
    for (const authored of file.data.events) {
      const id = canonicalise(draftEventId(authored["id"], eventPath), eventPath);
      const followUps = Array.isArray(authored["followUps"])
        ? authored["followUps"].map((entry) => {
            const record = entry as Record<string, unknown>;
            return {
              ...record,
              eventId: canonicalise(
                draftEventId(record["eventId"], eventPath),
                eventPath,
              ),
            };
          })
        : authored["followUps"];
      const parsed = eventDefinitionSchema.safeParse({
        ...authored,
        id,
        followUps,
      });
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new ContentFileError(
          eventPath,
          undefined,
          undefined,
          `${id}: ${
            issue === undefined
              ? "invalid event"
              : `${issue.path.join(".")}: ${issue.message}`
          }`,
        );
      }
      if (id in definitions) {
        throw new ContentFileError(
          eventPath,
          undefined,
          undefined,
          `duplicate event ID ${id}`,
        );
      }
      definitions[id] = parsed.data as EventDefinition;
    }
  }
  return {
    definitions,
    orderedIds: Object.keys(definitions).sort() as ContentId[],
  };
}
