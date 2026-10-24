import {
  purposeDefaults,
  type ArchitecturalConfig,
} from "../../src/architecturalGenerator";
const examples: { name: string; config: ArchitecturalConfig }[] = [
  {
    name: "Subtle Rustic Norse longhouse",
    config: {
      ...purposeDefaults("Longhouse"),
      style: "Rustic Norse",
      complexity: "Simple",
      extensions: 1,
      crossGables: "Occasional",
      ornamentation: "Subtle",
    },
  },
  {
    name: "Ornate Norse Chieftain's Hall",
    config: {
      ...purposeDefaults("Longhouse"),
      style: "Norse Chieftain's Hall",
      complexity: "Organic",
      extensions: 2,
      crossGables: "Occasional",
      ornamentation: "Ornate",
    },
  },
  {
    name: "Grand Fantasy Norse Chieftain's Hall",
    config: {
      ...purposeDefaults("Longhouse"),
      style: "Norse Chieftain's Hall",
      complexity: "Grand",
      extensions: 3,
      crossGables: "Prominent",
      ornamentation: "Fantasy",
    },
  },
  {
    name: "Medieval Cottage",
    config: {
      ...purposeDefaults("Cottage"),
      style: "Medieval Timber Cottage",
      extensions: 0,
      crossGables: "Occasional",
      ornamentation: "Subtle",
    },
  },
  {
    name: "Medieval Manor",
    config: {
      ...purposeDefaults("Manor"),
      style: "Medieval Manor",
      extensions: 2,
      crossGables: "Prominent",
      ornamentation: "Ornate",
    },
  },
  {
    name: "Mixed Architectural Fantasy",
    config: {
      ...purposeDefaults("Tavern/Inn"),
      style: "Mixed Architectural Fantasy",
      complexity: "Organic",
      extensions: 2,
      crossGables: "Prominent",
      ornamentation: "Fantasy",
    },
  },
];
export const advancedExamples = examples.map<{
  name: string;
  config: ArchitecturalConfig;
}>((example) => ({
  ...example,
  config: {
    ...example.config,
    roofs: ["Gable"],
    detail: "High",
    chimneys: false,
    ornaments: false,
    seed: "6142",
  },
}));
