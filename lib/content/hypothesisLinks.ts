/** Shared by the server-rendered Results page and the client-side hypothesis badges. */
export const TEST_SETUP_ID = "test-setup";

export function hypothesisAnchor(id: string): string {
  return `hypothesis-${id}`;
}
