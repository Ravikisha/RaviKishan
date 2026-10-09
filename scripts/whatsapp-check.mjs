// WhatsApp's shapes and guards, checked without a phone, a QR code or an
// account at risk.
//
// The assertions that matter are about addressing. Sending to the wrong JID is
// sending a private message to the wrong person, and it cannot be taken back —
// so the rule is that this layer REFUSES what it cannot parse rather than
// guessing, and never invents a country code.
//
//   node scripts/whatsapp-check.mjs
const W = await import("../lib/server/whatsappShape.js");

let pass = 0;
const fails = [];
const check = (ok, name, detail = "") => {
  if (ok) {
    pass++;
    console.log(`  OK  ${name}`);
  } else {
    fails.push(`${name}${detail ? ` - ${detail}` : ""}`);
    console.log(`  XX  ${name}${detail ? ` - ${detail}` : ""}`);
  }
};
const throws = (fn, name, re) => {
  try {
    fn();
    check(false, name, "it did not throw");
  } catch (e) {
    check(re.test(e.message), name, e.message.slice(0, 120));
  }
};

const USER = "918765432100@s.whatsapp.net";
const GROUP = "120363001234567890@g.us";

console.log("\njids: the same person must compare equal");
{
  check(W.isJid(USER) && W.isJid(GROUP), "user and group jids are recognised");
  check(!W.isJid("918765432100"), "a bare number is not a jid");
  check(W.isGroup(GROUP) && !W.isGroup(USER), "a group is distinguished from a person");

  // A device suffix is why a naive string compare misses an existing chat.
  check(W.bareJid("918765432100:12@s.whatsapp.net") === USER, "a device suffix is stripped", W.bareJid("918765432100:12@s.whatsapp.net"));
  check(W.bareJid(USER) === USER, "and a bare jid is unchanged");
  throws(() => W.bareJid("nonsense"), "something without a server part is refused", /no server part/);
  throws(() => W.bareJid(""), "and so is nothing", /not a JID/);

  check(W.phoneOfJid(USER) === "918765432100", "a user jid yields its digits");
  // A group has no phone number; returning something that looks like one would
  // be worse than returning nothing.
  check(W.phoneOfJid(GROUP) === "", "a group yields no phone number");
}

console.log("\nnumbers: never guess a country");
{
  check(W.jidFromPhone("+91 87654 32100") === "918765432100@s.whatsapp.net", "an international number converts", W.jidFromPhone("+91 87654 32100"));
  check(W.jidFromPhone(USER) === USER, "a jid passes through");

  // THE rule. A local number plus an assumed country code is a real person's
  // number somewhere else, and the message goes to them.
  throws(
    () => W.jidFromPhone("8765432100"),
    "a number with no country code is refused, not guessed",
    /no country code/
  );
  throws(() => W.jidFromPhone("+12"), "an implausibly short international number is refused", /too short/);
  throws(() => W.jidFromPhone("abc"), "something with no digits is refused", /no digits/);
  throws(() => W.jidFromPhone(""), "and nothing at all", /No number/);

  // Only with a country configured ON PURPOSE.
  check(
    W.jidFromPhone("08765432100", { defaultCountry: "91" }) === "918765432100@s.whatsapp.net",
    "a national number converts when a country is configured",
    W.jidFromPhone("08765432100", { defaultCountry: "91" })
  );
  check(
    W.jidFromPhone("918765432100", { defaultCountry: "91" }) === "918765432100@s.whatsapp.net",
    "and one that already carries the code is not doubled"
  );
  throws(
    () => W.jidFromPhone("12", { defaultCountry: "91" }),
    "an implausible national number is still refused",
    /does not look like a national number/
  );
}

console.log("\nmessages");
{
  const plain = W.shapeMessage({
    key: { id: "A1", remoteJid: USER, fromMe: false },
    message: { conversation: "hello there" },
    messageTimestamp: 1767225600,
    pushName: "Asha",
  });
  check(plain.text === "hello there", "a plain message yields its text");
  check(plain.type === "conversation", "and its type", plain.type);
  check(plain.from === USER, "and who sent it");
  check(plain.at.startsWith("2026-"), "with an ISO timestamp", plain.at);

  // In a group, `participant` is the speaker and remoteJid is the room.
  const group = W.shapeMessage({
    key: { id: "A2", remoteJid: GROUP, participant: "919999999999@s.whatsapp.net", fromMe: false },
    message: { extendedTextMessage: { text: "in a group" } },
    messageTimestamp: 1767225600,
  });
  check(group.chat === GROUP, "a group message is attributed to the group");
  check(group.from === "919999999999@s.whatsapp.net", "and to the person who actually spoke", group.from);

  const mine = W.shapeMessage({ key: { id: "A3", remoteJid: USER, fromMe: true }, message: { conversation: "mine" }, messageTimestamp: 1 });
  check(mine.fromMe === true && mine.from === "me", "my own message is marked as mine");

  // Media is DESCRIBED, never fetched: a chat listing that downloads every
  // image is one nobody runs twice.
  const img = W.shapeMessage({
    key: { id: "A4", remoteJid: USER },
    message: { imageMessage: { caption: "the diagram", mimetype: "image/jpeg", fileLength: 40321 } },
    messageTimestamp: 1,
  });
  check(img.text === "the diagram", "an image keeps its caption");
  check(img.media?.kind === "image" && img.media.bytes === 40321, "and describes the file", JSON.stringify(img.media));

  // An ephemeral wrapper hides the real content one level down.
  const eph = W.shapeMessage({
    key: { id: "A5", remoteJid: USER },
    message: { ephemeralMessage: { message: { conversation: "disappearing" } } },
    messageTimestamp: 1,
  });
  check(eph.text === "disappearing", "a disappearing message is unwrapped", eph.text);

  // An unknown kind must surface as its name, not as an empty bubble.
  const poll = W.shapeMessage({ key: { id: "A6", remoteJid: USER }, message: { pollCreationMessageV3: {} }, messageTimestamp: 1 });
  check(poll.type === "pollCreationMessageV3", "an unsupported kind keeps its name", poll.type);
  check(W.previewOf(poll) === "[pollCreationMessageV3]".replace("Message", ""), "and previews as something rather than nothing", W.previewOf(poll));
  check(W.previewOf(img) === "the diagram", "a caption is the preview when there is one");
  check(W.previewOf({ media: { kind: "audio" } }) === "[audio]", "and media says what it is", W.previewOf({ media: { kind: "audio" } }));
}

console.log("\nchats");
{
  const c = W.shapeChat({ id: USER, unreadCount: 3, conversationTimestamp: 1767225600 }, { name: "Asha Menon" });
  check(c.name === "Asha Menon" && c.unread === 3, "a chat carries its name and unread count");
  check(!c.isGroup, "and knows it is a person");
  const g = W.shapeChat({ id: GROUP, subject: "Rust meetup" });
  check(g.isGroup && g.name === "Rust meetup", "a group carries its subject", g.name);
  // Falling back to the raw jid would show the reader a wall of digits@domain.
  check(W.shapeChat({ id: USER }).name === "918765432100", "a nameless chat falls back to the number");
}

console.log("\nthe guards: one chat at a time, at human speed");
{
  // Bulk messaging is both what gets accounts banned and the part that reaches
  // people who did not ask to hear from you. Refused in the pure layer so no
  // caller can assemble it out of single sends.
  throws(
    () => W.assertSendable([USER, "919999999999@s.whatsapp.net"]),
    "sending to two chats at once is refused",
    /one chat at a time/
  );
  throws(() => W.assertSendable([]), "and to none", /No recipient/);
  check(W.assertSendable(USER) === true, "one recipient is allowed");

  throws(
    () => W.assertSendable(USER, { msSinceLast: 100 }),
    "two messages 100ms apart are refused",
    /reads as automation/
  );
  check(W.assertSendable(USER, { msSinceLast: 60_000 }) === true, "a minute apart is fine");
  throws(
    () => W.assertSendable(USER, { sentInLastHour: 60 }),
    "and the hourly cap stops a runaway loop",
    /in the last hour/
  );
}

console.log("\nwhat is refused outright");
{
  throws(() => W.assertRealChat("status@broadcast"), "status updates are not a chat", /Status updates/);
  throws(() => W.assertRealChat("12345@broadcast"), "broadcast lists are refused", /Broadcast lists/);
  throws(() => W.assertRealChat("12345@newsletter"), "channels are read-only", /read-only/);
  check(W.assertRealChat(USER) === USER, "a person is a real chat");
  check(W.assertRealChat(GROUP) === GROUP, "so is a group");
  check(W.assertRealChat("918765432100:3@s.whatsapp.net") === USER, "and it returns the bare jid to send to");
}

console.log("\nsearch");
{
  const msgs = [
    { id: "1", text: "the rust meetup is on friday", at: "2026-01-01T00:00:00.000Z", pushName: "Asha" },
    { id: "2", text: "bring the slides", at: "2026-01-02T00:00:00.000Z", pushName: "Bob" },
    { id: "3", text: "RUST again", at: "2026-01-03T00:00:00.000Z", pushName: "Asha" },
  ];
  const hits = W.searchMessages(msgs, "rust");
  check(hits.length === 2, "both mentions are found, whatever the case", String(hits.length));
  check(hits[0].id === "3", "newest first", hits.map((h) => h.id).join(","));
  check(W.searchMessages(msgs, "asha").length === 2, "a sender name matches");
  throws(() => W.searchMessages(msgs, "a"), "a one-character search is refused", /at least two characters/);
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log("FAILURES:");
  for (const f of fails) console.log("  - " + f);
  process.exit(1);
}
