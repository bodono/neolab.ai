import type { GameView } from "../../runtime/index.ts";

export type TutorialObjective =
  | "train"
  | "evaluate"
  | "productise"
  | "serve"
  | "fundraise"
  | "recruit"
  | "assign"
  | "buy-gpus"
  | "build-facility"
  | "complete";

export interface TutorialStep {
  readonly objective: TutorialObjective;
  readonly ordinal: number;
  readonly title: string;
  readonly instruction: string;
  readonly why: string;
  readonly destination?: "models" | "evaluations" | "compute" | "people" | "facilities";
  readonly targetIds: readonly string[];
  readonly waiting: boolean;
}

const RUNNING_PROJECT_STATUSES = new Set(["queued", "active", "paused"]);
const GUIDED_TUTORIAL_STARTING_OWNED_GPUS = 0;

export function tutorialStepForView(view: GameView): TutorialStep {
  const currentModel =
    view.models.cards.find((model) => model.modelId === view.models.currentModelId) ??
    view.models.cards.find((model) => model.isCurrentModel);
  const inFlight = (
    kind: "training" | "evaluation" | "productisation" | "construction",
    definitionId?: string,
  ): boolean =>
    view.facilities.projects.some(
      (project) =>
        project.kind === kind &&
        (definitionId === undefined || project.definitionId === definitionId) &&
        RUNNING_PROJECT_STATUSES.has(project.status),
    );

  if (view.compute.totalOwnedPhysicalGpus <= GUIDED_TUTORIAL_STARTING_OWNED_GPUS) {
    const waiting = view.compute.pendingDeliveries.length > 0;
    return {
      objective: "buy-gpus",
      ordinal: 1,
      title: waiting ? "Let the first GPU delivery arrive" : "Buy your first GPUs",
      instruction: waiting
        ? "Run the clock until the first cluster is installed."
        : "Open GPUs & compute, enter the procurement window, and order one block of 1,000 GPUs.",
      why: "The garage starts with no compute. Training only becomes possible once hardware is online.",
      destination: "compute",
      targetIds: waiting
        ? ["clock-2x"]
        : ["buy-gpus", "open-gpu-procurement", "nav-compute"],
      waiting,
    };
  }

  if (currentModel === undefined) {
    const waiting = inFlight("training");
    return {
      objective: "train",
      ordinal: 2,
      title: waiting ? "Let the training run finish" : "Train your first model",
      instruction: waiting
        ? "Time is paused. Run the clock at 2× until training completes."
        : "Open Models & deployment, configure a training run, and authorise it.",
      why: "Training turns research and compute into a model you can evaluate and sell.",
      destination: "models",
      targetIds: waiting
        ? ["clock-2x"]
        : ["authorise-training", "open-training", "nav-models"],
      waiting,
    };
  }

  const evaluated = currentModel.evaluations.some(
    (evaluation) => evaluation.programme !== "baseline",
  );
  if (!evaluated) {
    const waiting = inFlight("evaluation");
    return {
      objective: "evaluate",
      ordinal: 3,
      title: waiting ? "Let the evaluation finish" : "Evaluate the model",
      instruction: waiting
        ? "Run the clock until the evaluation report is ready."
        : "Open Safety & evaluations, run the first evaluation, and choose a feasible pace.",
      why: "Evaluations reveal evidence about model safety; clean results are useful, but never proof.",
      destination: "evaluations",
      targetIds: waiting
        ? ["clock-2x"]
        : [
            "evaluation-pacing-confirm",
            "first-evaluation",
            "evaluation-run-tab",
            "nav-evaluations",
          ],
      waiting,
    };
  }

  const productised = Object.values(currentModel.deployment.productisationRuns).some(
    (completed) => completed > 0,
  );
  if (!productised) {
    const waiting = inFlight("productisation");
    return {
      objective: "productise",
      ordinal: 4,
      title: waiting ? "Let launch preparation finish" : "Prepare and launch the model",
      instruction: waiting
        ? "Run the clock until the release is operational."
        : "Open Models & deployment, choose Configure launch, select Guarded API and Normal mode, then authorise it.",
      why: "A trained model earns no product revenue until you turn it into a reliable service.",
      destination: "models",
      targetIds: waiting
        ? ["clock-2x"]
        : [
            "productisation-authorise",
            "productisation-normal",
            "deployment-guarded-api",
            "model-release-tab",
            "nav-models",
          ],
      waiting,
    };
  }

  const servingBasisPoints =
    view.compute.queuedAllocation?.servingFleetShareBasisPoints ??
    view.compute.allocation.serving.basisPoints;
  if (servingBasisPoints === 0) {
    return {
      objective: "serve",
      ordinal: 5,
      title: "Allocate GPUs to serving",
      instruction:
        "Open GPUs & compute, allocate some GPUs to Serving, and cover the model's customer demand.",
      why: "Serving converts product demand into recurring revenue and can earn Aura.",
      destination: "compute",
      targetIds: ["serve-full-demand", "nav-compute"],
      waiting: false,
    };
  }

  if (view.meta?.labMaturity?.stage === "product") {
    return {
      objective: "serve",
      ordinal: 5,
      title: "Let the first revenue settle",
      instruction:
        "Run the clock until customers use the service and product revenue is recorded.",
      why: "Real commercial traction—not a launch button—opens the investor market.",
      destination: "compute",
      targetIds: ["clock-2x"],
      waiting: true,
    };
  }

  const acceptedFunding = view.fundraising.offers.some(
    (offer) => offer.status === "accepted",
  );
  if (!acceptedFunding) {
    const waiting = view.fundraising.activeCampaign !== undefined;
    const offerReady = view.fundraising.offers.some(
      (offer) => offer.status === "available",
    );
    return {
      objective: "fundraise",
      ordinal: 6,
      title: offerReady
        ? "Choose an investment offer"
        : waiting
          ? "Let the fundraising campaign finish"
          : "Raise the lab's first round",
      instruction: offerReady
        ? "Review the offers in the fundraising window and accept one set of terms."
        : waiting
          ? "Run the clock until investors return with offers."
          : "Open Fundraise from the cash card and launch an available campaign.",
      why: "External capital unlocks permanent facilities, but spends Aura and can attach obligations.",
      targetIds: waiting ? ["clock-2x"] : ["open-fundraising"],
      waiting,
    };
  }

  const serverRackCompleted = view.facilities.completed.some(
    (facility) => facility.definitionId === "base:facility.server-rack",
  );
  if (!serverRackCompleted) {
    const waiting = inFlight("construction", "base:facility.server-rack");
    return {
      objective: "build-facility",
      ordinal: 7,
      title: waiting ? "Let the Server Rack finish" : "Build the Server Rack",
      instruction: waiting
        ? "Run the clock until Server Rack construction is complete."
        : "Open Facilities & campus and commission the Server Rack.",
      why: "The Server Rack raises GPU capacity from the garage's 1,000 to 4,000.",
      destination: "facilities",
      targetIds: waiting ? ["clock-2x"] : ["build-server-rack", "nav-facilities"],
      waiting,
    };
  }

  const recruitedResearcher = view.people.roster.find(
    (researcher) => researcher.status === "employed",
  );
  if (recruitedResearcher === undefined) {
    return {
      objective: "recruit",
      ordinal: 8,
      title: "Recruit a star researcher",
      instruction:
        "Open People & appointments, review a candidate dossier, and recruit one person at their listed terms.",
      why: "Researchers strengthen specific programmes, but consume cash, Aura, roster capacity, and management attention.",
      destination: "people",
      targetIds: [
        "confirm-recruit-researcher",
        "review-researcher-dossier",
        "nav-people",
      ],
      waiting: false,
    };
  }

  if (recruitedResearcher.assignment === undefined) {
    return {
      objective: "assign",
      ordinal: 9,
      title: "Appoint a workstream lead",
      instruction:
        "Open the new researcher's dossier, choose a capability or safety programme, and confirm the assignment.",
      why: "A researcher's leadership bonus and many signature abilities only activate in the right appointment.",
      destination: "people",
      targetIds: [
        "confirm-workstream-assignment",
        "workstream-assignment-select",
        "assign-researcher",
        "nav-people",
      ],
      waiting: false,
    };
  }

  return {
    objective: "complete",
    ordinal: 9,
    title: "Tutorial complete",
    instruction:
      "You built the lab from an empty garage: compute, model, evidence, product, funding, facility, and research leadership.",
    why: "The full game asks you to combine these systems while managing research, money, rivals, politics, and safety.",
    targetIds: [],
    waiting: false,
  };
}
