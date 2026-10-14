import { describe, expect, it } from "vitest";
import { userFromHeaders } from "../../lib/auth/require-user";

describe("owner identity guard", () => {
  it("requires both Sites identity headers", () => {
    expect(userFromHeaders(new Headers())).toBeNull();
    expect(
      userFromHeaders(new Headers({ "oai-authenticated-user-id": "user-1" })),
    ).toBeNull();
  });

  it("returns a stable owner id and display identity", () => {
    const user = userFromHeaders(
      new Headers({
        "oai-authenticated-user-id": "user-1",
        "oai-authenticated-user-email": "person@example.com",
        "oai-authenticated-user-full-name": "Dublin Researcher",
      }),
    );

    expect(user).toEqual({
      userId: "user-1",
      email: "person@example.com",
      displayName: "Dublin Researcher",
    });
  });
});
