export type DelayedSendAgentReference = {
  projectId: string;
  sessionId: string;
};

export type DelayedSendAgentOption = DelayedSendAgentReference & {
  label: string;
};
