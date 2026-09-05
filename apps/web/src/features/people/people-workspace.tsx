import { useEffect, useState, type FormEvent, type ReactElement } from "react";

import type {
  GameView,
  PeopleAbilityView,
  PeopleAssignmentOptionView,
  PeopleBenefitRowView,
  PeopleCompactDestination,
  PeopleResearchSkillView,
  RosterResearcherView,
  TalentCandidateView,
} from "@neolab/sim/public";
import { formatValuation } from "@neolab/sim/public";

import {
  dismissResearcherCommand,
  recruitResearcherCommand,
  researcherAssignmentCommand,
  researcherCommitmentCommand,
  researcherUltimatumCommand,
  retentionOfferCommand,
} from "../../app/command-builders.ts";
import type { BrowserGameRuntime } from "../../runtime/index.ts";
import { MechanicHelp } from "../help/mechanic-help.tsx";
import { PixelPortrait } from "../portraits/pixel-portrait.tsx";
import { RealWorldProfile } from "./real-world-profile.tsx";

function money(value: number): string {
  return formatValuation(value);
}

function compactCadenceLabel(
  cadence: RosterResearcherView["compact"]["cadence"],
): string {
  if (cadence === "one-time") return "ONE-TIME PROMISE";
  if (cadence === "event-driven") return "PER-EVENT PROMISE";
  return "RECURRING PROMISE";
}

function compactScheduleLabel(researcher: RosterResearcherView): string {
  if (researcher.compactReview.reviewInWeeks !== undefined) {
    const weeks = `${String(researcher.compactReview.reviewInWeeks)} ${
      researcher.compactReview.reviewInWeeks === 1 ? "week" : "weeks"
    }`;
    if (researcher.compactStatus === "warning") return `Renew within ${weeks}`;
    return `${weeks} until review`;
  }
  if (researcher.compactStatus === "breached") {
    return "Complete the promise to repair the relationship";
  }
  if (researcher.compact.cadence === "one-time") {
    return researcher.compactReview.condition?.satisfied === true
      ? "Completed once"
      : "Activates with the relevant appointment or capability";
  }
  if (researcher.compact.cadence === "event-driven") {
    return "Checked on every relevant event";
  }
  return "Checked every week";
}

function compactStatusLabel(researcher: RosterResearcherView): string {
  if (!researcher.compactReview.includedInOffer) return "No promise";
  return researcher.compactReview.condition?.satisfied === true ? "Met" : "Not met";
}

function PromiseCondition({
  researcher,
  onNavigate,
  view,
  runtime,
  onMessage,
  detailed = false,
}: {
  readonly researcher: RosterResearcherView;
  readonly onNavigate: (destination: PeopleCompactDestination) => void;
  readonly view?: GameView;
  readonly runtime?: BrowserGameRuntime;
  readonly onMessage?: (message: string) => void;
  readonly detailed?: boolean;
}): ReactElement | null {
  const condition = researcher.compactReview.condition;
  if (condition === undefined) return null;
  const promiseWork = researcher.compactReview.promiseWork;
  const usesPromiseWork =
    promiseWork !== undefined && promiseWork.status !== "not-applicable";
  const showPromiseWork =
    usesPromiseWork && (!condition.satisfied || researcher.compactStatus === "warning");
  const command =
    view === undefined || !usesPromiseWork
      ? undefined
      : researcherCommitmentCommand(view, researcher.researcherId);
  const validation =
    command === undefined || runtime === undefined
      ? undefined
      : runtime.validate(command);

  return (
    <article
      className={`compact-promise-condition ${
        condition.satisfied ? "satisfied" : "outstanding"
      } ${usesPromiseWork ? promiseWork.status : "live-condition"}`}
    >
      <header>
        <div>
          <span>{compactCadenceLabel(researcher.compact.cadence)}</span>
          <strong>{researcher.compact.label}</strong>
        </div>
        <div className={`compact-state-badge ${researcher.compactStatus}`}>
          <strong>{compactStatusLabel(researcher)}</strong>
          <span>{compactScheduleLabel(researcher)}</span>
        </div>
      </header>
      <div>
        <strong>{researcher.compact.requirement}</strong>
        <p>{condition.progress}</p>
        {detailed && condition.explanation !== condition.progress ? (
          <small>{condition.explanation}</small>
        ) : null}
        {showPromiseWork ? (
          <small>
            {promiseWork.expectedDurationWeeks} weeks ·{" "}
            {money(promiseWork.cashCostMillions)} at current salary · 1 major-project slot
          </small>
        ) : null}
        {showPromiseWork &&
        promiseWork.status === "available" &&
        promiseWork.blockers.length > 0 ? (
          <small className="compact-promise-condition-blockers">
            {promiseWork.blockers.join(" · ")}
          </small>
        ) : null}
        <small className="compact-promise-reward">
          Reward: {researcher.compactReview.fulfilmentReward}
        </small>
      </div>
      {showPromiseWork &&
      promiseWork.status === "available" &&
      command !== undefined &&
      validation !== undefined ? (
        <button
          className="primary"
          type="button"
          disabled={!validation.ok}
          onClick={() => {
            if (!validation.ok || runtime === undefined) return;
            runtime.dispatch(command);
            onMessage?.(validation.preview.summary);
          }}
        >
          Fulfil promise
        </button>
      ) : condition.destination !== undefined &&
        condition.actionLabel !== undefined &&
        (!condition.satisfied || researcher.compactStatus === "warning") ? (
        <button
          className="text-button"
          type="button"
          onClick={() => onNavigate(condition.destination!)}
        >
          {condition.actionLabel} →
        </button>
      ) : null}
    </article>
  );
}

function specialistAreas(role: string): readonly string[] {
  return role
    .replace(/,\s+and\s+/gi, ", ")
    .split(/\s*,\s*|\s+and\s+/i)
    .map((area) => area.trim())
    .filter((area) => area.length > 0);
}

function assignmentBenefitLabel(
  researcher: RosterResearcherView,
  option: PeopleAssignmentOptionView,
): string {
  if (option.targetId !== undefined) {
    const skill = researcher.researchSkills.find(
      (candidate) => candidate.programmeId === option.targetId,
    );
    return skill === undefined
      ? ""
      : `skill ${String(skill.level)}/5 · +${percentage(skill.leadOutputBonusPercent)}%`;
  }

  const activatesSignature = researcher.signature.eligibleAssignmentKinds.includes(
    option.kind,
  );
  const signatureBenefit = activatesSignature
    ? `activates ${researcher.signature.label}`
    : undefined;
  switch (option.kind) {
    case "research-council":
      return [signatureBenefit, "supports government work"].filter(Boolean).join(" · ");
    case "safety-director":
      return (
        signatureBenefit ??
        "requires a compatible safety-leadership ability for a direct bonus"
      );
    case "external-council":
      return [signatureBenefit, "strengthens lobbying and coalitions"]
        .filter(Boolean)
        .join(" · ");
    default:
      return "";
  }
}

function SpecialtyChips({
  role,
  compact = false,
}: {
  readonly role: string;
  readonly compact?: boolean;
}): ReactElement {
  const areas = specialistAreas(role);
  return (
    <div
      className={`researcher-specialties ${compact ? "compact" : ""}`}
      aria-label={`Specialist areas: ${areas.join(", ")}`}
    >
      {areas.map((area, index) => (
        <span
          className={`specialty-chip specialty-${String((index % 4) + 1)}`}
          key={area}
        >
          {area}
        </span>
      ))}
    </div>
  );
}

function percentage(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

export function ResearchSkillProfile({
  skills,
  compact = false,
}: {
  readonly skills: readonly PeopleResearchSkillView[];
  readonly compact?: boolean;
}): ReactElement {
  if (compact) {
    const strongest = [...skills]
      .filter((skill) => skill.level > 0)
      .sort(
        (left, right) =>
          right.level - left.level ||
          right.leadOutputBonusPercent - left.leadOutputBonusPercent ||
          left.label.localeCompare(right.label),
      )
      .slice(0, 3);
    return (
      <section className="research-skill-profile compact">
        <header>
          <div>
            <span>BEST LEAD FITS</span>
          </div>
          <small>Top 3</small>
        </header>
        <div className="research-skill-grid">
          {strongest.map((skill) => (
            <article
              className={`research-skill ${skill.kind}`}
              key={skill.programmeId}
              title={`${skill.label}: ${String(skill.level)}/5. As lead: +${percentage(skill.leadOutputBonusPercent)}% research output.`}
            >
              <div>
                <span>{skill.label}</span>
                <strong>{skill.level}/5</strong>
              </div>
              <div
                className="research-skill-meter"
                role="meter"
                aria-label={`${skill.label} skill`}
                aria-valuemin={0}
                aria-valuemax={skill.maximumLevel}
                aria-valuenow={skill.level}
              >
                <i
                  style={{
                    width: `${String((skill.level / skill.maximumLevel) * 100)}%`,
                  }}
                />
              </div>
              <small>Lead +{percentage(skill.leadOutputBonusPercent)}%</small>
            </article>
          ))}
        </div>
      </section>
    );
  }
  const groups = [
    {
      kind: "capability" as const,
      label: "Capability programmes",
      skills: skills.filter((skill) => skill.kind === "capability"),
    },
    {
      kind: "safety" as const,
      label: "Safety programmes",
      skills: skills.filter((skill) => skill.kind === "safety"),
    },
  ];
  return (
    <section className={`research-skill-profile ${compact ? "compact" : ""}`}>
      <header>
        <div>
          <span>SCIENTIFIC LEAD FIT</span>
          <strong>Research skills used by programme leads</strong>
        </div>
        <small>0–5 skill</small>
      </header>
      {groups.map((group) => (
        <div className={`research-skill-group ${group.kind}`} key={group.kind}>
          <span>{group.label}</span>
          <div className="research-skill-grid">
            {group.skills.map((skill) => (
              <article
                className={`research-skill level-${String(skill.level)}`}
                key={skill.programmeId}
                title={`${skill.label}: ${String(skill.level)}/5. As lead: +${percentage(skill.leadOutputBonusPercent)}% research output.`}
              >
                <div>
                  <span>{skill.label}</span>
                  <strong>{skill.level}/5</strong>
                </div>
                <div
                  className="research-skill-meter"
                  role="meter"
                  aria-label={`${skill.label} skill`}
                  aria-valuemin={0}
                  aria-valuemax={skill.maximumLevel}
                  aria-valuenow={skill.level}
                >
                  <i
                    style={{
                      width: `${String((skill.level / skill.maximumLevel) * 100)}%`,
                    }}
                  />
                </div>
                <small>Lead +{percentage(skill.leadOutputBonusPercent)}%</small>
              </article>
            ))}
          </div>
        </div>
      ))}
      <p>
        Each skill point adds 3% research output when this researcher leads a programme,
        before signature abilities and other bonuses.
      </p>
    </section>
  );
}

/**
 * The one benefit breakdown, rendered identically in the recruitment dossier
 * and the roster panel. Both used to derive their own: the dossier showed
 * authored strength and the roster showed live modifier records, so a ramping
 * signature looked like it lost value the moment you hired someone. Every row
 * now carries both numbers, plus the generic lead bonus neither showed.
 */
function BenefitBreakdown({
  benefits,
  title,
  compact = false,
}: {
  readonly benefits: readonly PeopleBenefitRowView[];
  readonly title: string;
  readonly compact?: boolean;
}): ReactElement {
  const active = benefits.filter((row) => row.active);
  const inactive = benefits.filter((row) => !row.active);
  const ramping = active.filter((row) => !row.atFullStrength);
  return (
    <section
      className={`benefit-breakdown${compact ? " compact" : ""}`}
      aria-label={title}
    >
      <header>
        <div>
          <span>{title.toUpperCase()}</span>
          <strong>
            {active.length} active
            {ramping.length > 0 ? `, ${String(ramping.length)} still ramping` : ""}
          </strong>
        </div>
        {inactive.length === 0 ? null : (
          <span className="benefit-breakdown-badge">{inactive.length} inactive</span>
        )}
      </header>
      {benefits.length === 0 ? (
        <p className="benefit-breakdown-empty">
          No lab-wide effects; this researcher contributes through their programme skills.
        </p>
      ) : (
        <ul>
          {benefits.map((row) => (
            <li
              className={`benefit-row${row.active ? "" : " inactive"}${
                row.active && !row.atFullStrength ? " ramping" : ""
              }`}
              key={row.key}
            >
              <div className="benefit-row-head">
                <span className="benefit-row-source">{row.abilityLabel}</span>
                <strong>{row.targetLabel}</strong>
              </div>
              <div className="benefit-row-values">
                <b className={row.active ? "" : "muted"}>{row.currentLabel}</b>
                {row.atFullStrength ? null : (
                  <small>
                    {row.active ? "of" : "at full strength"} {row.fullLabel}
                  </small>
                )}
              </div>
              <details>
                <summary>
                  {row.active
                    ? row.atFullStrength
                      ? "Full strength"
                      : "Ramping"
                    : (row.inactiveReason ?? "Inactive")}
                </summary>
                <p>{row.explanation}</p>
                {row.stackingGroup === undefined ? null : (
                  <small>Stacking group: {row.stackingGroup}</small>
                )}
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AbilityCard({
  ability,
  kind,
}: {
  readonly ability: PeopleAbilityView;
  readonly kind: string;
}): ReactElement {
  return (
    <article className="people-ability-card">
      <p className="eyebrow">{kind}</p>
      <h3>{ability.label}</h3>
      {ability.notes === undefined ? null : <p>{ability.notes}</p>}
      <div className="ability-effects">
        {ability.effects.length === 0 ? (
          <span>Contextual effect; see assignment eligibility.</span>
        ) : (
          ability.effects.map((effect, index) => (
            <details
              className="ability-effect-help"
              key={`${effect.targetLabel}:${String(index)}`}
            >
              <summary>{effect.displayLabel}</summary>
              <p>{effect.explanation}</p>
              {effect.stackingGroup === undefined ? null : (
                <small>Stacking group: {effect.stackingGroup}</small>
              )}
            </details>
          ))
        )}
      </div>
      {ability.modes.map((mode) => (
        <div className="ability-mode" key={mode.label}>
          <b>{mode.label}</b>
          {mode.effects.map((effect) => (
            <details
              className="ability-effect-help"
              key={`${mode.label}:${effect.targetLabel}`}
            >
              <summary>{effect.displayLabel}</summary>
              <p>{effect.explanation}</p>
              {effect.stackingGroup === undefined ? null : (
                <small>Stacking group: {effect.stackingGroup}</small>
              )}
            </details>
          ))}
        </div>
      ))}
      <small>
        {ability.rampWeeks === 0
          ? "Immediate at full strength"
          : `Reaches full strength after ${String(ability.rampWeeks)} weeks`}
      </small>
      <MechanicHelp label={`${ability.label} stacking`}>
        Open a chip for its scope and stacking rule. Appointment and ramp conditions still
        apply.
      </MechanicHelp>
    </article>
  );
}

function RosterImpact({
  view,
  runtime,
  onInspect,
  onNavigate,
}: {
  readonly view: GameView;
  readonly runtime: BrowserGameRuntime;
  readonly onInspect: (researcherId: string) => void;
  readonly onNavigate: (destination: PeopleCompactDestination) => void;
}): ReactElement {
  const roster = view.people.roster.map((researcher) => {
    const assignmentOption =
      researcher.assignment === undefined
        ? undefined
        : view.people.assignmentOptions.find(
            (option) => option.optionId === researcher.assignment?.optionId,
          );
    return {
      researcher,
      assignmentBenefit:
        assignmentOption === undefined
          ? undefined
          : assignmentBenefitLabel(researcher, assignmentOption),
      // The same rows the dossier shows, rather than a third derivation from
      // live modifier records that disagreed with it.
      effects: researcher.benefits,
    };
  });
  const activeEffectCount = roster.reduce(
    (total, entry) => total + entry.effects.filter((row) => row.active).length,
    0,
  );
  const assignedCount = roster.filter(
    ({ researcher }) => researcher.assignment !== undefined,
  ).length;

  return (
    <section className="roster-impact" aria-labelledby="roster-impact-title">
      <header>
        <div>
          <p className="eyebrow">CURRENT ROSTER // ASSIGNMENTS, BENEFITS & PROMISES</p>
          <h3 id="roster-impact-title">Your star researchers</h3>
        </div>
        <div className="roster-impact-count">
          <strong>
            {assignedCount}/{roster.length}
          </strong>
          <span>assigned</span>
          <small>
            {activeEffectCount} active {activeEffectCount === 1 ? "effect" : "effects"}
          </small>
        </div>
        <MechanicHelp label="Researcher assignments and effects">
          Assign researchers to lead programmes. Skill sets the lead bonus; signature
          effects and promises follow the conditions in each dossier.
        </MechanicHelp>
      </header>
      <div className="roster-impact-grid">
        {roster.map(({ researcher, assignmentBenefit, effects }) => {
          const unassigned = researcher.assignment === undefined;
          return (
            <article
              className={`roster-impact-card unified-researcher-card ${unassigned ? "unassigned" : ""} compact-${researcher.compactStatus}`}
              key={researcher.researcherId}
            >
              <header>
                <PixelPortrait
                  className="researcher-pixel-portrait"
                  subjectId={researcher.portraitAssetId}
                  name={researcher.displayName}
                  brief={researcher.portraitBrief}
                  altText={researcher.portraitAltText}
                />
                <div className="unified-researcher-identity">
                  <div>
                    <div className="researcher-name-line">
                      <h4>{researcher.displayName}</h4>
                      <RealWorldProfile
                        inspirationName={researcher.inspirationName}
                        inspirationSummary={researcher.inspirationSummary}
                        compact
                      />
                    </div>
                    <p>{researcher.epithet}</p>
                  </div>
                  <SpecialtyChips role={researcher.role} compact />
                </div>
                <span
                  className={`condition-chip researcher-morale-chip ${researcher.morale.band}`}
                >
                  Morale: {researcher.morale.label}
                </span>
                <button
                  className={unassigned ? "primary" : "secondary"}
                  type="button"
                  data-tutorial-target={unassigned ? "assign-researcher" : undefined}
                  onClick={() => onInspect(researcher.researcherId)}
                >
                  {unassigned ? "Assign researcher" : "Inspect / reassign"}
                </button>
              </header>

              <div className="researcher-at-a-glance">
                <article className={unassigned ? "attention" : ""}>
                  <span>{unassigned ? "ASSIGNMENT REQUIRED" : "APPOINTMENT"}</span>
                  <strong>
                    {researcher.assignment?.label ?? "Choose a research programme"}
                  </strong>
                  <small>
                    {unassigned
                      ? "Leadership contribution inactive"
                      : assignmentBenefit === undefined || assignmentBenefit.length === 0
                        ? "Leadership and eligible signature effects active"
                        : assignmentBenefit}
                  </small>
                </article>
                <article>
                  <span>LAB IMPACT</span>
                  <strong>
                    {effects.length} active {effects.length === 1 ? "effect" : "effects"}
                  </strong>
                  <small>Facility-backed roster slot</small>
                </article>
                <article className={`promise-status compact-${researcher.compactStatus}`}>
                  <span>{compactCadenceLabel(researcher.compact.cadence)}</span>
                  <strong>{compactStatusLabel(researcher)}</strong>
                  <small>{researcher.compact.label}</small>
                </article>
              </div>

              <details
                className={`roster-impact-details compact-${researcher.compactStatus}`}
              >
                <summary>
                  <span>Benefits & promise details</span>
                  <small>
                    {effects.length} {effects.length === 1 ? "effect" : "effects"} ·{" "}
                    {compactScheduleLabel(researcher)}
                  </small>
                </summary>
                <div className="unified-researcher-columns">
                  <section className="researcher-active-benefits">
                    <BenefitBreakdown benefits={effects} title="Active lab benefits" />
                  </section>

                  <section className="researcher-promise-summary">
                    <PromiseCondition
                      researcher={researcher}
                      onNavigate={onNavigate}
                      view={view}
                      runtime={runtime}
                    />
                    <p className="compact-consequence">
                      {researcher.compactReview.consequence}
                    </p>
                  </section>
                </div>
              </details>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function StarResearcherStrip({
  view,
  onInspect,
  onOpenMarket,
}: {
  readonly view: GameView;
  readonly onInspect: (researcherId: string) => void;
  readonly onOpenMarket: () => void;
}): ReactElement {
  const locked = Math.max(0, view.people.slots.hardMaximum - view.people.slots.unlocked);
  return (
    <section className="researcher-strip" aria-labelledby="star-researchers-title">
      <header>
        <div>
          <p className="eyebrow">STAR ROSTER</p>
          <h2 id="star-researchers-title">Star researchers</h2>
        </div>
        <span>
          {view.people.slots.occupied} occupied · {view.people.slots.unlocked}/
          {view.people.slots.hardMaximum} slots unlocked
        </span>
        <button className="primary" type="button" onClick={onOpenMarket}>
          Recruit researchers
        </button>
      </header>
      <div className="researcher-strip-cards">
        {view.people.roster.map((researcher) => (
          <button
            className={`researcher-slot-card occupied ${researcher.warnings.length > 0 ? "attention" : ""}`}
            type="button"
            key={researcher.researcherId}
            onClick={() => onInspect(researcher.researcherId)}
            aria-label={`Inspect ${researcher.displayName}, inspired by ${researcher.inspirationName}`}
          >
            <PixelPortrait
              className="researcher-pixel-portrait"
              subjectId={researcher.portraitAssetId}
              name={researcher.displayName}
              brief={researcher.portraitBrief}
              altText={researcher.portraitAltText}
            />
            <span className="researcher-slot-name-line">
              <strong>{researcher.displayName}</strong>
              <RealWorldProfile
                inspirationName={researcher.inspirationName}
                inspirationSummary={researcher.inspirationSummary}
                compact
              />
            </span>
            <small>{researcher.assignment?.label ?? "Awaiting assignment"}</small>
            <SpecialtyChips role={researcher.role} compact />
            <span className={`condition-chip ${researcher.morale.band}`}>
              {researcher.warnings[0] ?? researcher.morale.label}
            </span>
          </button>
        ))}
        {Array.from({ length: view.people.slots.vacant }, (_, index) => (
          <button
            className="researcher-slot-card vacant"
            type="button"
            key={`vacant:${String(index)}`}
            onClick={onOpenMarket}
          >
            <span className="researcher-pixel-portrait empty" aria-hidden="true">
              +
            </span>
            <strong>Vacant slot</strong>
            <small>Talent market available</small>
            <span className="condition-chip steady">Recruit</span>
          </button>
        ))}
        {Array.from({ length: locked }, (_, index) => {
          const unlockFacility = view.people.slots.nextSlotFacilities[index];
          return (
            <div className="researcher-slot-card locked" key={`locked:${String(index)}`}>
              <span className="researcher-pixel-portrait empty" aria-hidden="true">
                ×
              </span>
              <strong>Locked slot</strong>
              <small>
                {unlockFacility === undefined
                  ? "Future facility required"
                  : `Build ${unlockFacility}`}
              </small>
              <span className="condition-chip">Facility required</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function RosterCapacity({
  view,
  onOpenFacilities,
}: {
  readonly view: GameView;
  readonly onOpenFacilities: () => void;
}): ReactElement {
  const locked = Math.max(0, view.people.slots.hardMaximum - view.people.slots.unlocked);

  return (
    <section className="people-capacity-panel" aria-labelledby="people-capacity-title">
      <header>
        <div>
          <span>STAR ROSTER // FACILITY-BACKED</span>
          <strong id="people-capacity-title">Talent capacity</strong>
        </div>
        {locked === 0 ? (
          <small>All roster slots unlocked</small>
        ) : (
          <button className="text-button" type="button" onClick={onOpenFacilities}>
            See how to unlock slots →
          </button>
        )}
      </header>
      <div className="people-capacity-summary">
        <article className="occupied">
          <span>On payroll</span>
          <strong>
            {view.people.slots.occupied}
            <small> / {view.people.slots.unlocked}</small>
          </strong>
          <small>Hired / available slots</small>
        </article>
        <article className="vacant">
          <span>Open now</span>
          <strong>{view.people.slots.vacant}</strong>
          <small>Ready to recruit</small>
        </article>
        <article className="locked">
          <span>To unlock</span>
          <strong>{locked}</strong>
          <small>Of {view.people.slots.hardMaximum} maximum slots</small>
        </article>
        <article className="pay-market">
          <span>Staff pay market</span>
          <strong>×{view.people.organisation.staffPayMultiplier.toFixed(2)}</strong>
          <small>Reprices each cycle · doubles every 30 frontier points</small>
        </article>
      </div>
      <div
        className="people-capacity-track"
        role="img"
        aria-label={`${String(view.people.slots.occupied)} researchers hired, ${String(view.people.slots.vacant)} open slots, and ${String(locked)} of ${String(view.people.slots.hardMaximum)} total slots still locked`}
      >
        {Array.from({ length: view.people.slots.hardMaximum }, (_, index) => {
          const researcher = view.people.roster[index];
          const state =
            researcher !== undefined
              ? "occupied"
              : index < view.people.slots.unlocked
                ? "vacant"
                : "locked";
          return (
            <span className={state} key={`capacity:${String(index)}`}>
              <i>{String(index + 1).padStart(2, "0")}</i>
              <strong>
                {researcher?.displayName ?? (state === "vacant" ? "OPEN" : "LOCKED")}
              </strong>
            </span>
          );
        })}
      </div>
    </section>
  );
}

export function PeopleWorkspace({
  view,
  runtime,
  onInspect,
  onRecruit,
  onNavigate,
  notice,
}: {
  readonly view: GameView;
  readonly runtime: BrowserGameRuntime;
  readonly onInspect: (researcherId: string) => void;
  readonly onRecruit: (researcherId: string) => void;
  readonly onNavigate: (destination: PeopleCompactDestination) => void;
  readonly notice: string | undefined;
}): ReactElement {
  return (
    <section className="console-panel people-workspace" aria-labelledby="people-title">
      <header className="panel-heading">
        <div>
          <p className="eyebrow">TALENT OFFICE</p>
          <h2 id="people-title">People & appointments</h2>
        </div>
        <span className="people-market-refresh">
          Market refresh · {view.people.market.refreshInWeeks}{" "}
          {view.people.market.refreshInWeeks === 1 ? "week" : "weeks"}
        </span>
      </header>
      {notice === undefined ? null : (
        <p className="people-notice" role="status">
          {notice}
        </p>
      )}
      <RosterCapacity view={view} onOpenFacilities={() => onNavigate("lab")} />
      {view.people.roster.length === 0 ? (
        <p className="empty-people-copy">No star researchers recruited.</p>
      ) : (
        <RosterImpact
          view={view}
          runtime={runtime}
          onInspect={onInspect}
          onNavigate={onNavigate}
        />
      )}
      <header className="talent-market-heading">
        <div>
          <p className="eyebrow">AVAILABLE TALENT</p>
          <h3>Current recruiting slate</h3>
        </div>
        <div className="panel-heading-tools">
          <span>{view.people.market.candidates.length} candidates</span>
          <MechanicHelp label="Recruiting cards">
            Cards show each candidate&apos;s best fits. Open the dossier for full terms.
          </MechanicHelp>
        </div>
      </header>
      <div className="talent-market-grid">
        {view.people.market.candidates.map((candidate) => (
          <article className="talent-card" key={candidate.researcherId}>
            <header>
              <PixelPortrait
                className="researcher-pixel-portrait"
                subjectId={candidate.portraitAssetId}
                name={candidate.displayName}
                brief={candidate.portraitBrief}
                altText={candidate.portraitAltText}
              />
              <div>
                <div className="researcher-name-line">
                  <h3>{candidate.displayName}</h3>
                  <RealWorldProfile
                    inspirationName={candidate.inspirationName}
                    inspirationSummary={candidate.inspirationSummary}
                    compact
                  />
                </div>
                <p>{candidate.epithet}</p>
              </div>
            </header>
            <SpecialtyChips role={candidate.role} />
            <ResearchSkillProfile compact skills={candidate.researchSkills} />
            <dl>
              <div>
                <dt>Listed terms</dt>
                <dd>
                  {money(candidate.listedTerms.signingCashMillions)} signing due now ·{" "}
                  {money(candidate.listedTerms.salaryMillionsPerCycle)} / cycle ·{" "}
                  {candidate.listedTerms.auraCost} Aura due now
                </dd>
              </div>
            </dl>
            <button
              className="secondary"
              type="button"
              data-tutorial-target="review-researcher-dossier"
              onClick={() => onRecruit(candidate.researcherId)}
            >
              Review dossier & terms
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

function closeOnEscape(onClose: () => void): () => void {
  const listener = (event: KeyboardEvent): void => {
    if (event.key === "Escape") onClose();
  };
  window.addEventListener("keydown", listener);
  return () => window.removeEventListener("keydown", listener);
}

export function ResearcherDossierDialog({
  researcher,
  view,
  runtime,
  onClose,
  onDismissed,
  onNavigate,
}: {
  readonly researcher: RosterResearcherView;
  readonly view: GameView;
  readonly runtime: BrowserGameRuntime;
  readonly onClose: () => void;
  readonly onDismissed: (name: string) => void;
  readonly onNavigate: (destination: PeopleCompactDestination) => void;
}): ReactElement {
  const [assignmentId, setAssignmentId] = useState(
    researcher.assignment?.optionId ?? view.people.assignmentOptions[0]?.optionId ?? "",
  );
  const [message, setMessage] = useState<string>();
  const [confirmDismissal, setConfirmDismissal] = useState(false);
  const [confirmDeparture, setConfirmDeparture] = useState(false);
  useEffect(() => closeOnEscape(onClose), [onClose]);
  const assignment = view.people.assignmentOptions.find(
    (option) => option.optionId === assignmentId,
  );
  const selectedResearchSkill =
    assignment?.targetId === undefined
      ? undefined
      : researcher.researchSkills.find(
          (skill) => skill.programmeId === assignment.targetId,
        );
  const assignmentCommand =
    assignment === undefined
      ? undefined
      : researcherAssignmentCommand(view, researcher.researcherId, assignment);
  const assignmentValidation =
    assignmentCommand === undefined ? undefined : runtime.validate(assignmentCommand);
  const dismissalCommand = dismissResearcherCommand(view, researcher.researcherId);
  const dismissalValidation = runtime.validate(dismissalCommand);
  const acceptUltimatumCommand = researcherUltimatumCommand(
    view,
    researcher.researcherId,
    "accept-conditions",
  );
  const acceptUltimatumValidation = runtime.validate(acceptUltimatumCommand);
  const departureUltimatumCommand = researcherUltimatumCommand(
    view,
    researcher.researcherId,
    "wish-well",
  );
  const departureUltimatumValidation = runtime.validate(departureUltimatumCommand);
  const salaryPerCycle = researcher.contract?.salaryMillionsPerCycle ?? 1;
  const reassuranceCash = salaryPerCycle * 0.5;
  const seriousRetentionCash = salaryPerCycle * 1.5;
  const reassuranceCommand = retentionOfferCommand(view, researcher.researcherId, {
    package: "reassurance",
  });
  const reassuranceValidation = runtime.validate(reassuranceCommand);
  const retentionCommand = retentionOfferCommand(view, researcher.researcherId, {
    package: "serious",
  });
  const retentionValidation = runtime.validate(retentionCommand);
  const retentionResponseKind = researcher.rivalApproach?.retentionResponseKind ?? "none";

  return (
    <div className="modal-backdrop">
      <section
        className="purchase-dialog people-dialog dossier-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="researcher-dossier-title"
      >
        <header className="panel-heading">
          <div className="dossier-identity">
            <PixelPortrait
              className="researcher-pixel-portrait large"
              subjectId={researcher.portraitAssetId}
              name={researcher.displayName}
              brief={researcher.portraitBrief}
              altText={researcher.portraitAltText}
            />
            <div>
              <p className="eyebrow">{researcher.epithet}</p>
              <div className="researcher-name-line">
                <h2 id="researcher-dossier-title">{researcher.displayName}</h2>
                <RealWorldProfile
                  inspirationName={researcher.inspirationName}
                  inspirationSummary={researcher.inspirationSummary}
                  compact
                />
              </div>
              <span>{researcher.role}</span>
            </div>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close researcher dossier"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <section className="assignment-panel dossier-assignment-panel">
          <div>
            <p className="eyebrow">WORKSTREAM ASSIGNMENT</p>
            <h3>{researcher.assignment?.label ?? "Unassigned"}</h3>
          </div>
          <label>
            <span>
              {researcher.assignment === undefined ? "Assign to" : "Reassign to"}
            </span>
            <select
              aria-label={`Assignment for ${researcher.displayName}`}
              data-tutorial-target="workstream-assignment-select"
              value={assignmentId}
              onChange={(event) => {
                setAssignmentId(event.target.value);
                setMessage(undefined);
              }}
            >
              {view.people.assignmentOptions.map((option) => {
                const currentLead = view.people.roster.find(
                  (candidate) =>
                    candidate.researcherId !== researcher.researcherId &&
                    candidate.status === "employed" &&
                    candidate.assignment?.optionId === option.optionId,
                );
                const benefit = assignmentBenefitLabel(researcher, option);
                return (
                  <option
                    disabled={currentLead !== undefined}
                    key={option.optionId}
                    value={option.optionId}
                  >
                    {option.label}
                    {benefit.length === 0 ? "" : ` · ${benefit}`}
                    {currentLead === undefined
                      ? ""
                      : ` · unavailable: led by ${currentLead.displayName}`}
                  </option>
                );
              })}
            </select>
          </label>
          <button
            className={researcher.assignment === undefined ? "primary" : "secondary"}
            type="button"
            data-tutorial-target="confirm-workstream-assignment"
            disabled={assignmentValidation?.ok !== true}
            title={
              assignmentValidation === undefined || assignmentValidation.ok
                ? undefined
                : assignmentValidation.errors.map((error) => error.message).join(" · ")
            }
            onClick={() => {
              if (assignmentCommand === undefined || assignmentValidation?.ok !== true)
                return;
              runtime.dispatch(assignmentCommand);
              setMessage(assignmentValidation.preview.summary);
            }}
          >
            {researcher.assignment === undefined
              ? "Confirm assignment"
              : "Apply reassignment"}
          </button>
          {selectedResearchSkill === undefined || assignment === undefined ? null : (
            <p className="assignment-fit-summary">
              <strong>{selectedResearchSkill.label} fit:</strong>{" "}
              {selectedResearchSkill.level}/5 skill gives +
              {percentage(selectedResearchSkill.leadOutputBonusPercent)}% baseline output
              as lead. Signature abilities may add a further appointment-specific effect.
            </p>
          )}
        </section>
        {message === undefined ? null : (
          <p className="people-notice dossier-notice" role="status">
            {message}
          </p>
        )}
        <RealWorldProfile
          inspirationName={researcher.inspirationName}
          inspirationSummary={researcher.inspirationSummary}
          biography={researcher.biography}
          sourceUrls={researcher.sourceUrls}
          realWorldPapers={researcher.realWorldPapers}
          showAttribution={false}
        />
        <ResearchSkillProfile skills={researcher.researchSkills} />
        <div className="researcher-condition-grid">
          <span className={`condition-chip ${researcher.morale.band}`}>
            Morale · {researcher.morale.label}
          </span>
          <span className={`condition-chip ${researcher.loyalty.band}`}>
            Loyalty · {researcher.loyalty.label}
          </span>
          <span className={`condition-chip ${researcher.burnout.band}`}>
            Workload · {researcher.burnout.label}
          </span>
          <span
            className={`condition-chip ${researcher.housing === "unhoused" ? "critical" : "steady"}`}
          >
            {researcher.housing}
          </span>
          <span className={`condition-chip ${researcher.departure.band}`}>
            Departure · {researcher.departure.label}
            {researcher.departure.topFactors.length > 0
              ? ` (${researcher.departure.topFactors.join(", ")})`
              : ""}
          </span>
          <span
            className={`condition-chip ${researcher.knowledgeTransferPercent >= 45 ? "warning" : "steady"}`}
            title="Share of their secret paper progress that leaks to a rival on any departure. Security posture and loyalty shrink it."
          >
            Leaves with {researcher.knowledgeTransferPercent}% of their secrets
          </span>
        </div>
        {researcher.warnings.length === 0 ? null : (
          <ul className="researcher-warning-list">
            {researcher.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}
        {researcher.rivalApproach === undefined ? null : (
          <section
            className="researcher-ultimatum-panel researcher-poaching-panel"
            role="alert"
          >
            <div>
              <div className="researcher-poaching-heading">
                <p className="eyebrow">
                  RIVAL APPROACH ·{" "}
                  {researcher.rivalApproach.stage === "counteroffer"
                    ? "FORMAL OFFER REPORTED"
                    : "EARLY CONTACT"}
                </p>
                <span
                  className={`condition-chip researcher-morale-chip ${researcher.morale.band}`}
                >
                  Morale: {researcher.morale.label}
                </span>
              </div>
              <h3>
                {researcher.rivalApproach.rivalLabName} is recruiting{" "}
                {researcher.displayName}
              </h3>
              <p>
                This is separate from morale: a researcher can be steady and still hear an
                attractive rival offer. The approach resolves in{" "}
                {researcher.rivalApproach.resolvesInWeeks} week
                {researcher.rivalApproach.resolvesInWeeks === 1 ? "" : "s"}. Retention is
                probabilistic; stronger terms improve the chance that they stay.
              </p>
              <div
                className={`retention-response-status ${retentionResponseKind}`}
                role="status"
              >
                <span>
                  {retentionResponseKind === "none"
                    ? "RESPONSE REQUIRED"
                    : "RESPONSE RECORDED"}
                </span>
                <strong>{researcher.rivalApproach.retentionResponseLabel}</strong>
                <small>
                  {retentionResponseKind === "none"
                    ? "Choose one response below. It cannot be replaced or submitted twice."
                    : `This response is locked in. The outcome resolves in ${String(researcher.rivalApproach.resolvesInWeeks)} week${researcher.rivalApproach.resolvesInWeeks === 1 ? "" : "s"}.`}
                </small>
              </div>
            </div>
            <div className="researcher-ultimatum-options">
              <article
                className={
                  retentionResponseKind === "reassurance" ? "selected" : undefined
                }
              >
                <strong>Immediate reassurance</strong>
                <p>
                  Spend {money(reassuranceCash)} now — half of their current per-cycle
                  salary. A modest signal of commitment that improves retention odds
                  without spending Aura.
                </p>
                <button
                  className="secondary"
                  type="button"
                  disabled={!reassuranceValidation.ok}
                  title={
                    reassuranceValidation.ok
                      ? undefined
                      : reassuranceValidation.errors
                          .map((error) => error.message)
                          .join(" · ")
                  }
                  onClick={() => {
                    if (!reassuranceValidation.ok) return;
                    runtime.dispatch(reassuranceCommand);
                    setMessage(reassuranceValidation.preview.summary);
                  }}
                >
                  {retentionResponseKind === "reassurance"
                    ? "Reassurance recorded ✓"
                    : `Offer ${money(reassuranceCash)}`}
                </button>
              </article>
              <article
                className={retentionResponseKind === "serious" ? "selected" : undefined}
              >
                <strong>Serious retention package</strong>
                <p>
                  Spend {money(seriousRetentionCash)} — one and a half times their current
                  per-cycle salary — and 1 Aura. A substantially stronger response, still
                  without any guarantee.
                </p>
                <button
                  className="primary"
                  type="button"
                  disabled={!retentionValidation.ok}
                  title={
                    retentionValidation.ok
                      ? undefined
                      : retentionValidation.errors
                          .map((error) => error.message)
                          .join(" · ")
                  }
                  onClick={() => {
                    if (!retentionValidation.ok) return;
                    runtime.dispatch(retentionCommand);
                    setMessage(retentionValidation.preview.summary);
                  }}
                >
                  {retentionResponseKind === "serious"
                    ? "Serious package recorded ✓"
                    : `Offer ${money(seriousRetentionCash)} + 1 Aura`}
                </button>
              </article>
            </div>
          </section>
        )}
        {researcher.ultimatum === undefined ? null : (
          <section className="researcher-ultimatum-panel" role="alert">
            <div>
              <p className="eyebrow">DECISION REQUIRED · RESIGNATION ULTIMATUM</p>
              <h3>
                {researcher.ultimatum.reason === "compact-breach"
                  ? `${researcher.compact.label} was breached`
                  : researcher.ultimatum.reason === "promise-breach"
                    ? "A direct promise was broken"
                    : researcher.ultimatum.reason === "provocation"
                      ? "Working conditions became untenable"
                      : "The quarterly relationship review failed"}
              </h3>
              <p>
                {researcher.ultimatum.reason === "compact-breach"
                  ? researcher.compact.requirement
                  : `${researcher.displayName} will leave unless the situation is resolved.`}{" "}
                Respond within {researcher.ultimatum.expiresInWeeks} week
                {researcher.ultimatum.expiresInWeeks === 1 ? "" : "s"}.
              </p>
            </div>
            <div className="researcher-ultimatum-options">
              <article>
                <strong>Accept conditions</strong>
                <p>
                  Spend 3 Aura and protect the current assignment for 52 weeks. Morale and
                  loyalty recover.
                </p>
                <button
                  className="primary"
                  type="button"
                  disabled={!acceptUltimatumValidation.ok}
                  onClick={() => {
                    runtime.dispatch(acceptUltimatumCommand);
                    setMessage(
                      acceptUltimatumValidation.ok
                        ? acceptUltimatumValidation.preview.summary
                        : undefined,
                    );
                  }}
                >
                  Accept conditions · 3 Aura
                </button>
              </article>
              <article>
                <strong>Let them leave</strong>
                <p>
                  The researcher departs immediately. Their slot becomes vacant and
                  knowledge may eventually reach a rival.
                </p>
                {confirmDeparture ? (
                  <div className="researcher-ultimatum-confirm">
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => setConfirmDeparture(false)}
                    >
                      Keep negotiating
                    </button>
                    <button
                      className="danger-button"
                      type="button"
                      disabled={!departureUltimatumValidation.ok}
                      onClick={() => {
                        runtime.dispatch(departureUltimatumCommand);
                        onDismissed(researcher.displayName);
                      }}
                    >
                      Confirm departure
                    </button>
                  </div>
                ) : (
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => setConfirmDeparture(true)}
                  >
                    Wish them well…
                  </button>
                )}
              </article>
            </div>
          </section>
        )}
        <div className="people-ability-grid">
          <AbilityCard ability={researcher.signature} kind="SIGNATURE" />
          <AbilityCard ability={researcher.passive} kind="PASSIVE" />
        </div>
        <div className="dossier-impact-grid">
          <BenefitBreakdown
            benefits={researcher.benefits}
            title="What they are adding"
            compact
          />
          <section className="compact-panel dossier-compact-panel">
            <PromiseCondition
              researcher={researcher}
              onNavigate={onNavigate}
              view={view}
              runtime={runtime}
              onMessage={setMessage}
              detailed
            />
            <details className="compact-consequence-disclosure">
              <summary>What happens if this promise is breached?</summary>
              <p>
                {researcher.compactReview.consequence.replace(
                  /^If this promise is breached, /,
                  "",
                )}
              </p>
            </details>
          </section>
        </div>
        <section className="contract-panel">
          <div>
            <p className="eyebrow">CONTRACT</p>
            <h3>{researcher.contractBand.replaceAll("-", " ")}</h3>
          </div>
          <span>
            {researcher.contract === undefined
              ? "Legacy terms"
              : `${money(researcher.contract.salaryMillionsPerCycle)} / cycle`}
          </span>
          {researcher.contract === undefined ? null : (
            <span>
              Annual market review +
              {researcher.contract.annualGrowthPercent.toFixed(1).replace(/\.0$/, "")}% ·
              next in {researcher.contract.nextReviewInWeeks} weeks
            </span>
          )}
        </section>
        <section className="dismissal-panel">
          {!confirmDismissal ? (
            <button
              className="text-button danger-link"
              type="button"
              onClick={() => setConfirmDismissal(true)}
            >
              Discuss departure…
            </button>
          ) : (
            <div role="alert">
              <strong>Confirm dismissal of {researcher.displayName}?</strong>
              <p>
                Severance {money(researcher.dismissal.severanceCashMillions)} · lose{" "}
                {researcher.dismissal.auraLoss} Aura. Their active bonuses end
                immediately.
              </p>
              <div>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => setConfirmDismissal(false)}
                >
                  Keep researcher
                </button>
                <button
                  className="danger-button"
                  type="button"
                  disabled={!dismissalValidation.ok}
                  onClick={() => {
                    runtime.dispatch(dismissalCommand);
                    onDismissed(researcher.displayName);
                  }}
                >
                  Confirm dismissal
                </button>
              </div>
            </div>
          )}
        </section>
      </section>
    </div>
  );
}

export function RecruitResearcherDialog({
  candidate,
  view,
  runtime,
  onClose,
  onRecruited,
}: {
  readonly candidate: TalentCandidateView;
  readonly view: GameView;
  readonly runtime: BrowserGameRuntime;
  readonly onClose: () => void;
  readonly onRecruited: (name: string) => void;
}): ReactElement {
  const listed = candidate.listedTerms;
  const [message, setMessage] = useState<string>();
  useEffect(() => closeOnEscape(onClose), [onClose]);
  const command = recruitResearcherCommand(view, candidate.researcherId);
  const validation = runtime.validate(command);

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!validation.ok) return;
    const receipt = runtime.dispatch(command);
    const recruited = receipt.domainEvents.some(
      (domainEvent) =>
        domainEvent.kind === "researcher-recruited" &&
        domainEvent.researcherId === candidate.researcherId,
    );
    if (!recruited) return;
    setMessage(
      `${candidate.displayName} joined the lab. Choose a research programme for them to lead from their roster dossier.`,
    );
    onRecruited(candidate.displayName);
  }

  return (
    <div className="modal-backdrop">
      <section
        className="purchase-dialog people-dialog recruitment-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recruit-title"
      >
        <header className="panel-heading">
          <div className="dossier-identity">
            <PixelPortrait
              className="researcher-pixel-portrait large"
              subjectId={candidate.portraitAssetId}
              name={candidate.displayName}
              brief={candidate.portraitBrief}
              altText={candidate.portraitAltText}
            />
            <div>
              <p className="eyebrow">RECRUITMENT DOSSIER · {candidate.epithet}</p>
              <div className="researcher-name-line">
                <h2 id="recruit-title">{candidate.displayName}</h2>
                <RealWorldProfile
                  inspirationName={candidate.inspirationName}
                  inspirationSummary={candidate.inspirationSummary}
                  compact
                />
              </div>
              <span>{candidate.role}</span>
            </div>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close recruitment dossier"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <RealWorldProfile
          inspirationName={candidate.inspirationName}
          inspirationSummary={candidate.inspirationSummary}
          biography={candidate.biography}
          sourceUrls={candidate.sourceUrls}
          realWorldPapers={candidate.realWorldPapers}
          showAttribution={false}
        />
        <ResearchSkillProfile skills={candidate.researchSkills} />
        <div className="people-ability-grid compact">
          <AbilityCard ability={candidate.signature} kind="SIGNATURE" />
          <AbilityCard ability={candidate.passive} kind="PASSIVE" />
        </div>
        <div className="dossier-impact-grid">
          <BenefitBreakdown
            benefits={candidate.benefits}
            title="What they would add"
            compact
          />
          <section
            className="compact-panel dossier-compact-panel"
            aria-label="Promise included in the offer"
          >
            <article className="compact-promise-condition offer-preview">
              <header>
                <div>
                  <span>{compactCadenceLabel(candidate.compact.cadence)}</span>
                  <strong>{candidate.compact.label}</strong>
                </div>
                <div className="compact-state-badge tracking">
                  <strong>Included</strong>
                  <span>Starts when hired</span>
                </div>
              </header>
              <div>
                <strong>{candidate.compact.requirement}</strong>
                <p>
                  This promise is part of the listed package. Its progress, deadline, and
                  fulfilment control appear here after recruitment.
                </p>
              </div>
            </article>
          </section>
        </div>
        <form className="recruitment-form" onSubmit={submit}>
          <section className="recruitment-listed-terms wide" aria-label="Listed terms">
            <article>
              <span>Signing cash · paid now</span>
              <strong>{money(listed.signingCashMillions)}</strong>
              {listed.foundingHireGuarantee !== undefined &&
              listed.foundingHireGuarantee.cashReliefMillions > 0 ? (
                <small>
                  Founding-hire guarantee covers{" "}
                  {money(listed.foundingHireGuarantee.cashReliefMillions)}
                </small>
              ) : null}
            </article>
            <article>
              <span>Salary · every 4 weeks</span>
              <strong>{money(listed.salaryMillionsPerCycle)}</strong>
            </article>
            <article>
              <span>Aura · paid now</span>
              <strong>{listed.auraCost}</strong>
              <small>
                {listed.auraCostBreakdown.baseAuraCost} base +{" "}
                {listed.auraCostBreakdown.globalMarketPressureAuraCost} global market
                pressure = {listed.auraCostBreakdown.marketAdjustedAuraCost} Aura
              </small>
              {listed.foundingHireGuarantee !== undefined &&
              listed.foundingHireGuarantee.auraRelief > 0 ? (
                <small>
                  Founding-hire guarantee −{listed.foundingHireGuarantee.auraRelief} ·{" "}
                  {listed.auraCost} due now
                </small>
              ) : null}
              <small>
                World frontier capability{" "}
                {Math.round(listed.auraCostBreakdown.worldFrontierCapability)} · ×
                {listed.auraCostBreakdown.marketPressureMultiplier.toFixed(2)}
              </small>
            </article>
          </section>
          {listed.foundingHireGuarantee === undefined ? null : (
            <aside className="recruitment-assignment-note recruitment-founding-hire-note wide">
              <span>FOUNDING HIRE BACKING</span>
              <p>
                Opening credit permits the signing payment to overdraw cash. The
                founding-hire reserve sponsors the Aura; salary remains recurring.
              </p>
              <strong>{listed.foundingHireGuarantee.auraRelief} Aura sponsored</strong>
            </aside>
          )}
          <aside className="recruitment-assignment-note wide">
            <span>PROGRAMME LEAD COMES NEXT</span>
            <p>
              They join unassigned. Open their dossier to choose a programme; you can
              reassign them later.
            </p>
          </aside>
          {!validation.ok ? (
            <p className="validation-error wide">
              {validation.errors.map((error) => error.message).join(" · ")}
            </p>
          ) : null}
          {message === undefined ? null : (
            <p className="people-notice wide" role="status">
              {message}
            </p>
          )}
          <div className="recruitment-actions wide">
            <button className="secondary" type="button" onClick={onClose}>
              Cancel
            </button>
            <button
              className="primary"
              type="submit"
              data-tutorial-target="confirm-recruit-researcher"
              disabled={!validation.ok}
            >
              Recruit at listed terms
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
