import type {
  CommandMeta,
  GameView,
  BuyGpusCommand,
  JoinGovernmentProgrammeCommand,
  StartLobbyingProjectCommand,
  StartAgiComponentCommand,
  SetModelAutonomyCommand,
  LeaveGovernmentProgrammeCommand,
  SellGpusCommand,
  AcceptFundingOfferCommand,
  SetGpuAllocationCommand,
  SetPublicPriceCommand,
  StartFacilityConstructionCommand,
  StartFundraisingCampaignCommand,
  StartTrainingRunCommand,
  StartEvaluationCommand,
  StartProductisationCommand,
  SetModelDeploymentPolicyCommand,
  DismissAnomalyCommand,
  InvestigateAnomalyCommand,
  ChooseGenericAdvanceCommand,
  ChoosePublicationPolicyCommand,
  AssignResearcherCommand,
  RecruitResearcherCommand,
  StartResearcherCommitmentCommand,
  SubmitRetentionOfferCommand,
  ResolveResearcherUltimatumCommand,
  DismissResearcherCommand,
  ReviewRivalRaceCommand,
  ConductRivalDiplomacyCommand,
  ProposeCoalitionCommand,
  RatifyCoalitionCommand,
  StartCoalitionProjectCommand,
  SetCandidateAccessCommand,
  IsolateCandidateArtifactCommand,
  ResolveCandidateIncidentCommand,
  NominateCandidateCommand,
  CommitCapabilityProofCommand,
  CommitCandidateSafetyResponseCommand,
  ResolvePressureCollisionCommand,
  EnterFinalReviewCommand,
  ChooseDeploymentModeCommand,
  ResolveRolloutDecisionCommand,
  ResolveContainmentFailureCommand,
  ConfigureCandidateRetirementCommand,
  TransmitCandidateRetirementCommand,
  ChoosePostRetirementPathCommand,
  ChooseFalseDawnPathCommand,
  TransmitDeploymentCommand,
  AdvanceWorldWaitingCommand,
} from "@neolab/sim/public";

let commandSequence = 0;

function meta(view: GameView): CommandMeta {
  commandSequence += 1;
  return {
    commandId:
      `web:command:${String(commandSequence).padStart(6, "0")}` as CommandMeta["commandId"],
    expectedTick: view.meta.tick as CommandMeta["expectedTick"],
    issuedBy: "player",
  };
}

function labId(view: GameView): SetGpuAllocationCommand["labId"] {
  return view.identity.labId as SetGpuAllocationCommand["labId"];
}

export function allocationCommand(
  view: GameView,
  servingFleetShareBasisPoints: number,
  capabilityBasisPoints: number,
  programmeWeights?: {
    readonly capabilityDomainWeights?: Readonly<Record<string, number>>;
    readonly safetyProgramWeights?: Readonly<Record<string, number>>;
  },
): SetGpuAllocationCommand {
  return {
    kind: "set-gpu-allocation",
    meta: meta(view),
    labId: labId(view),
    allocation: {
      servingFleetShareBasisPoints,
      capabilityBasisPoints,
      capabilityDomainWeights:
        programmeWeights?.capabilityDomainWeights ??
        view.compute.queuedAllocation?.capabilityDomainWeights ??
        Object.fromEntries(
          view.compute.allocation.capabilityPrograms.map((program) => [
            program.id,
            program.basisPoints,
          ]),
        ),
      safetyProgramWeights:
        programmeWeights?.safetyProgramWeights ??
        view.compute.queuedAllocation?.safetyProgramWeights ??
        Object.fromEntries(
          view.compute.allocation.safetyPrograms.map((program) => [
            program.id,
            program.basisPoints,
          ]),
        ),
    } as SetGpuAllocationCommand["allocation"],
  };
}

export function researcherUltimatumCommand(
  view: GameView,
  researcherId: string,
  response: ResolveResearcherUltimatumCommand["response"],
): ResolveResearcherUltimatumCommand {
  return {
    kind: "resolve-researcher-ultimatum",
    meta: meta(view),
    labId: labId(view),
    researcherId: researcherId as ResolveResearcherUltimatumCommand["researcherId"],
    response,
  };
}

export function candidateAccessCommand(
  view: GameView,
  modelId: string,
  level: SetCandidateAccessCommand["level"],
  confirmationText?: string,
): SetCandidateAccessCommand {
  return {
    kind: "set-candidate-access",
    meta: meta(view),
    labId: labId(view),
    modelId: modelId as SetCandidateAccessCommand["modelId"],
    level,
    ...(confirmationText === undefined ? {} : { confirmationText }),
  };
}

export function isolateCandidateArtifactCommand(
  view: GameView,
  modelId: string,
): IsolateCandidateArtifactCommand {
  return {
    kind: "isolate-candidate-artifact",
    meta: meta(view),
    labId: labId(view),
    modelId: modelId as IsolateCandidateArtifactCommand["modelId"],
  };
}

export function resolveCandidateIncidentCommand(
  view: GameView,
  modelId: string,
): ResolveCandidateIncidentCommand {
  return {
    kind: "resolve-candidate-incident",
    meta: meta(view),
    labId: labId(view),
    modelId: modelId as ResolveCandidateIncidentCommand["modelId"],
  };
}

export function nominateCandidateCommand(
  view: GameView,
  modelId: string,
  abandonInFlightTraining = false,
): NominateCandidateCommand {
  return {
    kind: "nominate-candidate",
    meta: meta(view),
    labId: labId(view),
    modelId: modelId as NominateCandidateCommand["modelId"],
    ...(abandonInFlightTraining ? { abandonInFlightTraining: true } : {}),
  };
}

export function capabilityProofCommand(
  view: GameView,
  challengeId: CommitCapabilityProofCommand["challengeId"],
  verifierId?: CommitCapabilityProofCommand["verifierId"],
): CommitCapabilityProofCommand {
  return {
    kind: "commit-capability-proof",
    meta: meta(view),
    labId: labId(view),
    challengeId,
    ...(verifierId === undefined ? {} : { verifierId }),
  };
}

export function candidateSafetyResponseCommand(
  view: GameView,
  responseId: CommitCandidateSafetyResponseCommand["responseId"],
): CommitCandidateSafetyResponseCommand {
  return {
    kind: "commit-candidate-safety-response",
    meta: meta(view),
    labId: labId(view),
    responseId,
  };
}

export function pressureCollisionCommand(
  view: GameView,
  optionId: ResolvePressureCollisionCommand["optionId"],
): ResolvePressureCollisionCommand {
  return {
    kind: "resolve-pressure-collision",
    meta: meta(view),
    labId: labId(view),
    optionId,
  };
}

export function enterFinalReviewCommand(view: GameView): EnterFinalReviewCommand {
  return {
    kind: "enter-final-review",
    meta: meta(view),
    labId: labId(view),
  };
}

export function deploymentModeCommand(
  view: GameView,
  modeId: ChooseDeploymentModeCommand["modeId"],
  confirmationText?: string,
  prosperityProgrammeId?: ChooseDeploymentModeCommand["prosperityProgrammeId"],
): ChooseDeploymentModeCommand {
  return {
    kind: "choose-deployment-mode",
    meta: meta(view),
    labId: labId(view),
    modeId,
    ...(prosperityProgrammeId === undefined ? {} : { prosperityProgrammeId }),
    ...(confirmationText === undefined ? {} : { confirmationText }),
  };
}

export function rolloutDecisionCommand(
  view: GameView,
  optionId: ResolveRolloutDecisionCommand["optionId"],
): ResolveRolloutDecisionCommand {
  return {
    kind: "resolve-rollout-decision",
    meta: meta(view),
    labId: labId(view),
    optionId,
  };
}

export function containmentFailureCommand(
  view: GameView,
  actionId: ResolveContainmentFailureCommand["actionId"],
): ResolveContainmentFailureCommand {
  return {
    kind: "resolve-containment-failure",
    meta: meta(view),
    labId: labId(view),
    actionId,
  };
}

export function configureCandidateRetirementCommand(
  view: GameView,
  modelId: string,
  procedureId: ConfigureCandidateRetirementCommand["procedureId"],
  archiveDisposition: ConfigureCandidateRetirementCommand["archiveDisposition"],
): ConfigureCandidateRetirementCommand {
  return {
    kind: "configure-candidate-retirement",
    meta: meta(view),
    labId: labId(view),
    modelId: modelId as ConfigureCandidateRetirementCommand["modelId"],
    procedureId,
    archiveDisposition,
  };
}

export function transmitCandidateRetirementCommand(
  view: GameView,
  modelId: string,
  confirmationText: string,
  procedureId?: TransmitCandidateRetirementCommand["procedureId"],
  archiveDisposition?: TransmitCandidateRetirementCommand["archiveDisposition"],
): TransmitCandidateRetirementCommand {
  return {
    kind: "transmit-candidate-retirement",
    meta: meta(view),
    labId: labId(view),
    modelId: modelId as TransmitCandidateRetirementCommand["modelId"],
    confirmationText,
    ...(procedureId === undefined ? {} : { procedureId }),
    ...(archiveDisposition === undefined ? {} : { archiveDisposition }),
  };
}

export function choosePostRetirementPathCommand(
  view: GameView,
  path: ChoosePostRetirementPathCommand["path"],
): ChoosePostRetirementPathCommand {
  return {
    kind: "choose-post-retirement-path",
    meta: meta(view),
    labId: labId(view),
    path,
  };
}

export function chooseFalseDawnPathCommand(
  view: GameView,
  presentationKey: string,
  path: ChooseFalseDawnPathCommand["path"],
): ChooseFalseDawnPathCommand {
  return {
    kind: "choose-false-dawn-path",
    meta: meta(view),
    labId: labId(view),
    presentationKey,
    path,
  };
}

export function transmitDeploymentCommand(
  view: GameView,
  modelId: string,
  confirmationText: string,
): TransmitDeploymentCommand {
  return {
    kind: "transmit-deployment",
    meta: meta(view),
    labId: labId(view),
    modelId: modelId as TransmitDeploymentCommand["modelId"],
    confirmationText,
  };
}

export function advanceWorldWaitingCommand(view: GameView): AdvanceWorldWaitingCommand {
  return {
    kind: "advance-world-waiting",
    meta: meta(view),
    labId: labId(view),
  };
}

export function buyGpusCommand(
  view: GameView,
  generationId: string,
  thousandUnits: number,
): BuyGpusCommand {
  return {
    kind: "buy-gpus",
    meta: meta(view),
    labId: labId(view),
    generationId: generationId as BuyGpusCommand["generationId"],
    thousandUnits,
  };
}

export function sellGpusCommand(
  view: GameView,
  generationId: string,
  thousandUnits: number,
): SellGpusCommand {
  return {
    kind: "sell-gpus",
    meta: meta(view),
    labId: labId(view),
    generationId: generationId as SellGpusCommand["generationId"],
    thousandUnits,
  };
}

export function startAgiComponentCommand(
  view: GameView,
  componentType: string,
): StartAgiComponentCommand {
  return {
    kind: "start-agi-component",
    meta: meta(view),
    labId: labId(view),
    componentType: componentType as StartAgiComponentCommand["componentType"],
  };
}

export function setAutonomyCommand(
  view: GameView,
  level: number,
  confirmationText?: string,
): SetModelAutonomyCommand {
  return {
    kind: "set-model-autonomy",
    meta: meta(view),
    labId: labId(view),
    level: level as SetModelAutonomyCommand["level"],
    ...(confirmationText === undefined ? {} : { confirmationText }),
  };
}

export function reviewRivalRaceCommand(view: GameView): ReviewRivalRaceCommand {
  return {
    kind: "review-rival-race",
    meta: meta(view),
    labId: labId(view),
  };
}

export function startLobbyingCommand(
  view: GameView,
  objective: StartLobbyingProjectCommand["objective"],
  approach: StartLobbyingProjectCommand["approach"],
): StartLobbyingProjectCommand {
  return {
    kind: "start-lobbying-project",
    meta: meta(view),
    labId: labId(view),
    objective,
    approach,
  };
}

export function joinProgrammeCommand(
  view: GameView,
  programmeId: string,
): JoinGovernmentProgrammeCommand {
  return {
    kind: "join-government-programme",
    meta: meta(view),
    labId: labId(view),
    programmeId: programmeId as JoinGovernmentProgrammeCommand["programmeId"],
  };
}

export function leaveProgrammeCommand(
  view: GameView,
  programmeId: string,
): LeaveGovernmentProgrammeCommand {
  return {
    kind: "leave-government-programme",
    meta: meta(view),
    labId: labId(view),
    programmeId: programmeId as LeaveGovernmentProgrammeCommand["programmeId"],
  };
}

export function facilityCommand(
  view: GameView,
  definitionId: string,
): StartFacilityConstructionCommand {
  return {
    kind: "start-facility-construction",
    meta: meta(view),
    labId: labId(view),
    definitionId: definitionId as StartFacilityConstructionCommand["definitionId"],
  };
}

export function fundraisingCampaignCommand(
  view: GameView,
  campaign: StartFundraisingCampaignCommand["campaign"],
): StartFundraisingCampaignCommand {
  return {
    kind: "start-fundraising-campaign",
    meta: meta(view),
    labId: labId(view),
    campaign,
  };
}

export function acceptFundingOfferCommand(
  view: GameView,
  offerId: string,
): AcceptFundingOfferCommand {
  return {
    kind: "accept-funding-offer",
    meta: meta(view),
    labId: labId(view),
    offerId: offerId as AcceptFundingOfferCommand["offerId"],
  };
}

export function priceCommand(
  view: GameView,
  priceTier: SetPublicPriceCommand["priceTier"],
): SetPublicPriceCommand {
  return {
    kind: "set-public-price",
    meta: meta(view),
    labId: labId(view),
    priceTier,
  };
}

export function trainingCommand(
  view: GameView,
  input: Omit<StartTrainingRunCommand, "kind" | "meta" | "labId">,
): StartTrainingRunCommand {
  return {
    kind: "start-training-run",
    meta: meta(view),
    labId: labId(view),
    ...input,
  };
}

export function evaluationCommand(
  view: GameView,
  modelId: string,
  definitionId: string,
  durationWeeks?: number,
): StartEvaluationCommand {
  return {
    kind: "start-evaluation",
    meta: meta(view),
    labId: labId(view),
    modelId: modelId as StartEvaluationCommand["modelId"],
    definitionId: definitionId as StartEvaluationCommand["definitionId"],
    ...(durationWeeks === undefined ? {} : { durationWeeks }),
  };
}

export function productisationCommand(
  view: GameView,
  modelId: string,
  mode: StartProductisationCommand["mode"],
): StartProductisationCommand {
  return {
    kind: "start-productisation",
    meta: meta(view),
    labId: labId(view),
    modelId: modelId as StartProductisationCommand["modelId"],
    mode,
  };
}

export function deploymentCommand(
  view: GameView,
  modelId: string,
  policy: SetModelDeploymentPolicyCommand["policy"],
): SetModelDeploymentPolicyCommand {
  return {
    kind: "set-model-deployment-policy",
    meta: meta(view),
    labId: labId(view),
    modelId: modelId as SetModelDeploymentPolicyCommand["modelId"],
    policy,
  };
}

export function anomalyCommand(
  view: GameView,
  anomalyId: string,
  action: "dismiss" | "investigate",
): DismissAnomalyCommand | InvestigateAnomalyCommand {
  return {
    kind: action === "dismiss" ? "dismiss-anomaly" : "investigate-anomaly",
    meta: meta(view),
    labId: labId(view),
    anomalyId: anomalyId as DismissAnomalyCommand["anomalyId"],
  };
}

export function genericAdvanceCommand(
  view: GameView,
  programId: string,
  threshold: number,
  optionId: string,
): ChooseGenericAdvanceCommand {
  return {
    kind: "choose-generic-advance",
    meta: meta(view),
    labId: labId(view),
    programId: programId as ChooseGenericAdvanceCommand["programId"],
    threshold,
    optionId: optionId as ChooseGenericAdvanceCommand["optionId"],
  };
}

export function publicationPolicyCommand(
  view: GameView,
  paperId: string,
  policy: ChoosePublicationPolicyCommand["policy"],
): ChoosePublicationPolicyCommand {
  return {
    kind: "choose-publication-policy",
    meta: meta(view),
    labId: labId(view),
    paperId: paperId as ChoosePublicationPolicyCommand["paperId"],
    policy,
  };
}

export function researcherAssignmentCommand(
  view: GameView,
  researcherId: string,
  assignment: AssignResearcherCommand["assignment"],
): AssignResearcherCommand {
  return {
    kind: "assign-researcher",
    meta: meta(view),
    labId: labId(view),
    researcherId: researcherId as AssignResearcherCommand["researcherId"],
    assignment: {
      kind: assignment.kind,
      ...(assignment.targetId === undefined ? {} : { targetId: assignment.targetId }),
      role: assignment.role,
    },
  };
}

export function recruitResearcherCommand(
  view: GameView,
  researcherId: string,
): RecruitResearcherCommand {
  return {
    kind: "recruit-researcher",
    meta: meta(view),
    labId: labId(view),
    researcherId: researcherId as RecruitResearcherCommand["researcherId"],
  };
}

export function researcherCommitmentCommand(
  view: GameView,
  researcherId: string,
): StartResearcherCommitmentCommand {
  return {
    kind: "start-researcher-commitment",
    meta: meta(view),
    labId: labId(view),
    researcherId: researcherId as StartResearcherCommitmentCommand["researcherId"],
  };
}

export function retentionOfferCommand(
  view: GameView,
  researcherId: string,
  offer: SubmitRetentionOfferCommand["offer"],
): SubmitRetentionOfferCommand {
  return {
    kind: "submit-retention-offer",
    meta: meta(view),
    labId: labId(view),
    researcherId: researcherId as SubmitRetentionOfferCommand["researcherId"],
    offer,
  };
}

export function dismissResearcherCommand(
  view: GameView,
  researcherId: string,
): DismissResearcherCommand {
  return {
    kind: "dismiss-researcher",
    meta: meta(view),
    labId: labId(view),
    researcherId: researcherId as DismissResearcherCommand["researcherId"],
    confirmed: true,
  };
}

export function rivalDiplomacyCommand(
  view: GameView,
  rivalLabId: string,
  action: ConductRivalDiplomacyCommand["action"],
): ConductRivalDiplomacyCommand {
  return {
    kind: "conduct-rival-diplomacy",
    meta: meta(view),
    labId: labId(view),
    rivalLabId: rivalLabId as ConductRivalDiplomacyCommand["rivalLabId"],
    action,
  };
}

export function proposeCoalitionCommand(
  view: GameView,
  rivalLabIds: readonly string[],
  governmentMember: boolean,
  independentBodyMember: boolean,
): ProposeCoalitionCommand {
  return {
    kind: "propose-coalition",
    meta: meta(view),
    labId: labId(view),
    rivalLabIds: rivalLabIds as ProposeCoalitionCommand["rivalLabIds"],
    governmentMember,
    independentBodyMember,
  };
}

export function coalitionProjectCommand(
  view: GameView,
  coalitionId: string,
  projectType: StartCoalitionProjectCommand["projectType"],
  contributorLabId?: string,
  assetKind?: StartCoalitionProjectCommand["assetKind"],
): StartCoalitionProjectCommand {
  return {
    kind: "start-coalition-project",
    meta: meta(view),
    labId: labId(view),
    coalitionId: coalitionId as StartCoalitionProjectCommand["coalitionId"],
    projectType,
    ...(contributorLabId === undefined
      ? {}
      : {
          contributorLabId: contributorLabId as NonNullable<
            StartCoalitionProjectCommand["contributorLabId"]
          >,
        }),
    ...(assetKind === undefined ? {} : { assetKind }),
  };
}

export function ratifyCoalitionCommand(
  view: GameView,
  coalitionId: string,
): RatifyCoalitionCommand {
  return {
    kind: "ratify-coalition",
    meta: meta(view),
    labId: labId(view),
    coalitionId: coalitionId as RatifyCoalitionCommand["coalitionId"],
  };
}
