export const WORKBENCH_CONVERSATION_KEY = 'daoge-pic:workbench-conversation-id';

export function workbenchConversationId(storage, createId = () => crypto.randomUUID()) {
  const stored = storage.getItem(WORKBENCH_CONVERSATION_KEY);
  if (stored) return stored;
  const value = 'workbench-' + createId();
  storage.setItem(WORKBENCH_CONVERSATION_KEY, value);
  return value;
}
