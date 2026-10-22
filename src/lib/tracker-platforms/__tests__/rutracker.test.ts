// src/lib/tracker-platforms/__tests__/rutracker.test.ts
//
// Fixtures are trimmed, anonymized copies of the live markup.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { sanitizeNetworkError } from "@/lib/error-utils"
import {
  parseRutrackerCaptcha,
  parseRutrackerCredentials,
  parseRutrackerIndex,
  parseRutrackerProfile,
  parseSeedingCount,
  parseTrafStats,
  RutrackerAdapter,
} from "../adapters/rutracker"
import { SessionExpiredError } from "../helpers/errors"

const HOST = "rutracker.org"
const BASE_URL = `https://${HOST}`
const TOKEN = "0123456789abcdef0123456789abcdef"
const CREDS = JSON.stringify({ username: "someone", password: "right-p@ss&<" })

const INDEX_HTML = `<!DOCTYPE html><html><head><title>RuTracker.org</title>
<script>window.BB = { cur_domain: 'rutracker.org', form_token: '${TOKEN}', };</script></head><body>
<div id="page_header"><table><tr><td><span>
<a id="logged-in-username" class="truncated-text" href="https://rutracker.org/forum/profile.php?mode=viewprofile&amp;u=1234">someone</a>
</span></td><td><ul class="inlined top-menus"><li><span class="menu-split">
<a href="privmsg.php?folder=inbox" class="">ЛС &#x2709;</a>
</span></li></ul></td></tr></table></div>
<table id="latest-news-table">
<tr><td><div class="news_date">18-Сен</div></td><td class="w100"><div id="news-t-111" class="news_title"><a href="viewtopic.php?t=111">День Рождения</a></div></td></tr>
</table>
</body></html>`

const GUEST_INDEX_HTML = `<!DOCTYPE html><html><head><title>RuTracker.org</title></head><body>
<form id="login-form-quick" action="https://rutracker.org/forum/login.php" method="post">
<input type="text" name="login_username"><input type="password" name="login_password">
</form>
<div id="quick-search-guest"></div>
</body></html>`

const CHALLENGE_HTML = `<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title></head><body></body></html>`

function profileHtml(body: string, extraBelow = ""): string {
  return `<!DOCTYPE html><html><head><title>someone</title>
<script>window.BB = { form_token: '${TOKEN}', };</script></head><body>
<a id="logged-in-username" href="https://rutracker.org/forum/profile.php?mode=viewprofile&amp;u=1234">someone</a>
<table class="user_profile bordered w100"><tr>${body}</tr></table>${extraBelow}
</body></html>`
}

// The member's own profile with upload statistics switched off.
const PROFILE_STATS_OFF = profileHtml(`
<td class="row1 vTop tCenter w30">
  <div id="avatar-img" class="mrg_4 med">Аватар: нет</div>
  <div class="med mrg_4">Звание:
      нет </div>
</td>
<td class="row1 w70 vTop">
  <table class="user_details borderless w100">
    <tr><th>Роль:</th><td id="role"><b>Пользователь</b> <b id="ban-msg" style="color: red;"></b></td></tr>
    <tr><th>Стаж:</th><td><b>45 мин.</b></td></tr>
    <tr><th>Зарегистрирован:</th><td><b title="">2026-10-22</b></td></tr>
    <tr><th id="del-posts-header">Сообщения:</th><td><div id="posts">
        Нет
      </div></td></tr>
    <tr><th>Статистика отключена:</th><td><a class="med" href="viewtopic.php?p=1#1"><i>как включить</i></a></td></tr>
  </table>
</td>`)

// A member with statistics on, a title, releases and a seeding list.
const PROFILE_STATS_ON = profileHtml(
  `
<td class="row1 vTop tCenter w30">
  <div id="avatar-img" class="mrg_4 med"><img src="https://static.rutracker.cc/avatars/0/34/1234.jpg" alt="avatar"></div>
  <div id="rank-img" class="mrg_6"><img class="user-rank" src="https://static.rutracker.cc/ranks/vip_orange.gif" alt=""></div>
  <div class="med mrg_4">Звание:
      <b>VIP (Адм)</b> </div>
</td>
<td class="row1 w70 vTop">
  <table class="user_details borderless w100">
    <tr><th>Роль:</th><td id="role"><b>Участник групп</b> <b id="ban-msg" style="color: red;"></b></td></tr>
    <tr><th>Стаж:</th><td><b>18 лет 6 месяцев</b></td></tr>
    <tr><th>Зарегистрирован:</th><td><b title="">2008-04-06</b></td></tr>
    <tr><th>Раздачи:</th><td class="med"><ul class="inlined middot-separated">
      <li><a href="tracker.php?rid=1234" class="med"><b>217</b> раздач <b> &middot; 1001.95&nbsp;GB</b></a></li>
      <li><span class="tor-icon tor-approved">&radic;</span>209 <b>&middot;</b> <b class="seedmed">976.96&nbsp;GB</b></li>
    </ul></td></tr>
    <tr><th id="del-posts-header">Сообщения:</th><td><div id="posts"><ul class="inlined middot-separated">
      <li><a href="search.php?uid=1234&amp;search_author" class="med"><b>1,234</b> сообщений</a></li>
    </ul></div></td></tr>
    <tr><th style="vertical-align: middle;">
        Статистика отданного:
      </th><td><table id="traf-stats-tbl" class="borderless"><tr class="row1"><td id="uploaded_total"></td></tr></table></td></tr>
  </table>
</td>`,
  `<div><h1 class="pagetitle tCenter">
  Сидируемые раздачи:
  <span class="normal">[ <span class="a-like">показать</span> ]</span>
</h1></div>`
)

const SEEDING_HTML = profileHtml(
  "<td></td>",
  `<h1 class="pagetitle tCenter">
  Сидируемые раздачи:
          <b>100</b>
        </h1>
<table class="forumline tablesorter"><tbody>
<tr class="row1 hl-tr"><td><a href="viewforum.php?f=1">Раздел</a></td><td><a href="viewtopic.php?t=1">Тема</a></td><td><b class="seedmed">4</b> | <b class="leechmed">0</b></td></tr>
</tbody></table>`
)

const TRAF_STATS = JSON.stringify({
  uploaded_day: "2.86&nbsp;GB",
  up_yesterday: "83.99&nbsp;GB",
  uploaded_total_real: "175.558&nbsp;TB",
  uploaded_total: "175.56&nbsp;TB",
  up_rare_day: "0&nbsp;B",
  up_rare_yesterday: "1.08&nbsp;GB",
  up_rare_total_real: "5.013&nbsp;TB",
  up_rare_total: "5.013&nbsp;TB",
  up_rare_total_byte: "5511890221000",
  uploaded_total_byte: "193027526010024",
  action: "get_traf_stats",
})

/** A login form with a captcha, as the site shows it; the values are placeholders. */
function captchaForm(n: number): string {
  return `<form id="login-form-full" action="login.php" method="post"><table>
<tr><td><input type="text" name="login_username"></td></tr>
<tr><td class="tRight nowrap">Код:</td><td>
  <div><img src="https://static.rutracker.cc/captcha/0000${n}.jpg?1" width="120" height="72" alt="pic"></div>
  <div>
    <input type="hidden" name="cap_sid" value="sid${n}">
    <input class="reg-input" type="text" name="cap_code_abc${n}" value="" size="25">
  </div>
</td></tr></table></form>`
}

const SOLVER = { url: "http://flaresolverr.example:8191", maxTimeout: 60000 }
const OPTIONS = { flaresolverr: SOLVER }

interface SiteSetup {
  /** The response to the login form: the signed-in page, a captcha, or the form again */
  login?: "ok" | "captcha" | "refused"
  /** The login page shows a captcha before anything is posted */
  captchaOnPage?: boolean
  /** The captcha answer that, with the right password, results in a login */
  captchaAnswer?: string
  profile?: string
  ajax?: { status: number; body: string }
  seeding?: { status: number; body: string }
}

interface SolverRequest {
  cmd: string
  url?: string
  session?: string
  cookies?: { name: string; value: string }[]
}

/** A submitted form's action and fields, read back from its data: page. */
function formOf(url: string): { action: string; fields: Record<string, string> } {
  const page = decodeURIComponent(url.slice(url.indexOf(",") + 1))
  const decodeEntities = (v: string) =>
    v
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&")
  const fields: Record<string, string> = {}
  for (const m of page.matchAll(/<input type="hidden" name="([^"]*)" value="([^"]*)">/g)) {
    fields[decodeEntities(m[1])] = decodeEntities(m[2])
  }
  return { action: decodeEntities(page.match(/action="([^"]*)"/)?.[1] ?? ""), fields }
}

/**
 * A mock FlareSolverr in front of the site. A browser session is logged in after
 * a login with the right password or a request with the issued bb_session cookie.
 */
function mockSolver(setup: SiteSetup = {}): SolverRequest[] {
  const sent: SolverRequest[] = []
  const loggedIn = new Set<string>()
  let captchas = 0
  vi.spyOn(global, "fetch").mockImplementation((async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as SolverRequest
    sent.push(body)
    const solved = (url: string, html: string, status = 200, cookies: unknown[] = []) =>
      new Response(
        JSON.stringify({
          status: "ok",
          message: "",
          solution: { url, status, response: html, cookies },
        }),
        { status: 200 }
      )
    if (body.cmd !== "request.get") return new Response(JSON.stringify({ status: "ok" }))
    const session = body.session ?? ""
    if (body.cookies?.some((c) => c.name === "bb_session" && c.value === "issued")) {
      loggedIn.add(session)
    }
    const url = body.url ?? ""
    if (url.startsWith("data:")) {
      const { action, fields } = formOf(url)
      if (action.endsWith("/forum/login.php")) {
        const outcome = setup.login ?? "ok"
        const answered = Object.entries(fields).some(
          ([name, value]) => name.startsWith("cap_code_") && value === setup.captchaAnswer
        )
        if (answered && fields.login_password === "right-p@ss&<") {
          loggedIn.add(session)
          return solved(`${BASE_URL}/forum/privmsg.php?folder=inbox`, INDEX_HTML, 200, [
            { name: "bb_session", value: "issued", domain: ".rutracker.org" },
          ])
        }
        if (outcome === "ok" && fields.login_password === "right-p@ss&<") {
          loggedIn.add(session)
          return solved(`${BASE_URL}/forum/privmsg.php?folder=inbox`, INDEX_HTML, 200, [
            { name: "bb_session", value: "issued", domain: ".rutracker.org" },
          ])
        }
        if (outcome === "captcha") {
          captchas += 1
          return solved(action, captchaForm(captchas))
        }
        return solved(action, GUEST_INDEX_HTML)
      }
      if (action.endsWith("/forum/ajax.php")) {
        const reply = setup.ajax ?? { status: 200, body: TRAF_STATS }
        const escaped = reply.body
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
        return solved(action, `<html><body><pre>${escaped}</pre></body></html>`, reply.status)
      }
      const reply = setup.seeding ?? { status: 200, body: SEEDING_HTML }
      return solved(action, reply.body, reply.status)
    }
    if (url.endsWith("/forum/login.php") && !session) {
      return solved(url, GUEST_INDEX_HTML, 200, [
        { name: "cf_clearance", value: "cleared", domain: ".rutracker.org" },
        { name: "bb_guid", value: "guid", domain: ".rutracker.org" },
      ])
    }
    if (url.endsWith("/forum/login.php")) {
      if (!setup.captchaOnPage) return solved(url, GUEST_INDEX_HTML)
      captchas += 1
      return solved(url, captchaForm(captchas))
    }
    if (url.includes("/forum/privmsg.php")) {
      if (!loggedIn.has(session)) return solved(`${BASE_URL}/forum/login.php`, GUEST_INDEX_HTML)
      return solved(url, INDEX_HTML)
    }
    if (url.includes("/forum/profile.php")) {
      if (!loggedIn.has(session)) return solved(`${BASE_URL}/forum/login.php`, GUEST_INDEX_HTML)
      return solved(url, setup.profile ?? PROFILE_STATS_OFF)
    }
    return new Response(JSON.stringify({ status: "error", message: "unknown page" }), {
      status: 500,
    })
  }) as unknown as typeof fetch)
  return sent
}

/**
 * Runs a call across the adapter's pauses between requests. Its session key is
 * an scrypt hash computed off the timer queue, so the clock is advanced until
 * the call settles rather than once.
 */
async function settle<T>(promise: Promise<T>): Promise<T> {
  let done = false
  const caught = promise.then(
    (value) => {
      done = true
      return value
    },
    (err: unknown) => {
      done = true
      return err
    }
  )
  while (!done) {
    await vi.advanceTimersByTimeAsync(2000)
    await new Promise((resolve) => setImmediate(resolve))
  }
  const result = await caught
  if (result instanceof Error) throw result
  return result as T
}

/** The request of each FlareSolverr call, with forms listed by their action. */
function described(sent: SolverRequest[]): string[] {
  return sent.map((r) =>
    r.cmd !== "request.get"
      ? r.cmd
      : r.url?.startsWith("data:")
        ? `POST ${formOf(r.url).action}`
        : `GET ${r.url}${r.cookies?.length ? " +cookie" : ""}`
  )
}

describe("parseRutrackerCredentials", () => {
  it("reads the username and password, keeping the password as typed", () => {
    expect(
      parseRutrackerCredentials(JSON.stringify({ username: " someone ", password: " pw " }))
    ).toEqual({ username: "someone", password: " pw " })
  })

  it("rejects a blob without a password", () => {
    expect(() => parseRutrackerCredentials(JSON.stringify({ username: "someone" }))).toThrow(
      /password/
    )
  })
})

describe("parseRutrackerIndex", () => {
  it("reads the account and the form token from the header", () => {
    expect(parseRutrackerIndex(INDEX_HTML, HOST)).toEqual({
      username: "someone",
      userId: 1234,
      formToken: TOKEN,
    })
  })

  it("reads the guest index as an expired session", () => {
    expect(() => parseRutrackerIndex(GUEST_INDEX_HTML, HOST)).toThrow(SessionExpiredError)
  })

  it("reports a Cloudflare challenge served with a 200", () => {
    const err = (() => {
      try {
        parseRutrackerIndex(CHALLENGE_HTML, HOST)
      } catch (e) {
        return e as Error
      }
    })()
    expect(sanitizeNetworkError(err?.message ?? "")).toBe(
      "Cloudflare challenge blocked the request"
    )
  })
})

describe("parseRutrackerProfile", () => {
  it("reads a profile with statistics off", () => {
    const profile = parseRutrackerProfile(PROFILE_STATS_OFF, HOST, BASE_URL)
    expect(profile).toMatchObject({
      group: "User",
      joinedDate: "2026-10-22",
      formToken: TOKEN,
      hasSeedingList: false,
    })
    expect(profile.avatarUrl).toBeUndefined()
    expect(profile.meta).toEqual({
      role: "User",
      restricted: false,
      tenure: "45 minutes",
      posts: 0,
      statsEnabled: false,
    })
  })

  it("gives the tenure in English", () => {
    const tenure = (text: string) =>
      parseRutrackerProfile(
        PROFILE_STATS_ON.replace("<b>18 лет 6 месяцев</b>", `<b>${text}</b>`),
        HOST,
        BASE_URL
      ).meta.tenure

    expect(tenure("18 лет 6 месяцев")).toBe("18 years 6 months")
    expect(tenure("1 год 2 месяца")).toBe("1 year 2 months")
    expect(tenure("21 день")).toBe("21 days")
    expect(tenure("5 часов")).toBe("5 hours")
    expect(tenure("45 мин.")).toBe("45 minutes")
    expect(tenure("давно")).toBe("давно")
  })

  it("translates roles and titles to English and leaves unknown ones as printed", () => {
    const profile = (role: string, title: string) =>
      parseRutrackerProfile(
        PROFILE_STATS_ON.replace("<b>Участник групп</b>", `<b>${role}</b>`).replace(
          "<b>VIP (Адм)</b>",
          `<b>${title}</b>`
        ),
        HOST,
        BASE_URL
      ).meta

    expect(profile("Модератор", "Техническая помощь (неактивен)")).toMatchObject({
      role: "Moderator",
      title: "Technical Support (inactive)",
    })
    expect(profile("Администратор", "Старожил")).toMatchObject({
      role: "Administrator",
      title: "Oldie",
    })
    expect(profile("Новая роль", "Admin gray")).toMatchObject({
      role: "Новая роль",
      title: "Admin gray",
    })
  })

  it("reads the title, releases and statistics marker of a fuller profile", () => {
    const profile = parseRutrackerProfile(PROFILE_STATS_ON, HOST, BASE_URL)
    expect(profile).toMatchObject({
      group: "VIP (Adm)",
      joinedDate: "2008-04-06",
      avatarUrl: "https://static.rutracker.cc/avatars/0/34/1234.jpg",
      hasSeedingList: true,
    })
    expect(profile.meta).toMatchObject({
      role: "Group Member",
      title: "VIP (Adm)",
      posts: 1234,
      releases: 217,
      verifiedReleases: 209,
      statsEnabled: true,
    })
    expect(profile.meta.releasesBytes).toBe(Math.round(1001.95 * 2 ** 30))
    expect(profile.meta.verifiedReleasesBytes).toBe(Math.round(976.96 * 2 ** 30))
  })

  it("takes a rank shown only as an image from its title", () => {
    const html = PROFILE_STATS_OFF.replace(
      '<div class="med mrg_4">',
      '<div id="rank-img"><img class="user-rank" src="r.gif" title="Top Seed 03"></div><div class="med mrg_4">'
    )
    expect(parseRutrackerProfile(html, HOST, BASE_URL).group).toBe("Top Seed 03")
  })

  it("flags a restriction notice", () => {
    const html = PROFILE_STATS_OFF.replace(
      '<b id="ban-msg" style="color: red;"></b>',
      '<b id="ban-msg" style="color: red;">Бан до 2026-11-01</b>'
    )
    expect(parseRutrackerProfile(html, HOST, BASE_URL).meta).toMatchObject({
      restricted: true,
      restrictionNote: "Бан до 2026-11-01",
    })
  })

  it("throws on a page without the profile table", () => {
    expect(() => parseRutrackerProfile(INDEX_HTML, HOST, BASE_URL)).toThrow(
      /Unexpected response from rutracker.org/
    )
  })
})

describe("parseTrafStats", () => {
  it("takes the exact byte totals and parses the day figures", () => {
    expect(parseTrafStats(TRAF_STATS, HOST)).toEqual({
      uploadedBytes: 193027526010024,
      uploadedTodayBytes: Math.round(2.86 * 2 ** 30),
      uploadedYesterdayBytes: Math.round(83.99 * 2 ** 30),
      rareUploadedBytes: 5511890221000,
      rareUploadedTodayBytes: 0,
      rareUploadedYesterdayBytes: Math.round(1.08 * 2 ** 30),
    })
  })

  it("throws on a reply that is not the statistics", () => {
    expect(() => parseTrafStats("<html></html>", HOST)).toThrow(/not JSON/)
    expect(() => parseTrafStats("{}", HOST)).toThrow(/no upload total/)
  })
})

describe("parseSeedingCount", () => {
  it("reads the count from the heading", () => {
    expect(parseSeedingCount(SEEDING_HTML)).toBe(100)
  })

  it("reads none as zero", () => {
    const none = SEEDING_HTML.replace("<b>100</b>", '<span class="normal">нет</span>')
    expect(parseSeedingCount(none)).toBe(0)
  })

  it("is unknown without the heading", () => {
    expect(parseSeedingCount(PROFILE_STATS_OFF)).toBeUndefined()
  })
})

describe("parseRutrackerCaptcha", () => {
  it("reads the image, the sid and the answer's field name", () => {
    expect(parseRutrackerCaptcha(captchaForm(7), BASE_URL)).toEqual({
      imageUrl: "https://static.rutracker.cc/captcha/00007.jpg?1",
      capSid: "sid7",
      codeField: "cap_code_abc7",
    })
  })

  it("finds none on a login form without one", () => {
    expect(parseRutrackerCaptcha(GUEST_INDEX_HTML, BASE_URL)).toBeNull()
  })

  it("rejects an image on another host, which the server would fetch", () => {
    const elsewhere = captchaForm(1).replace("static.rutracker.cc", "evil.example")
    expect(parseRutrackerCaptcha(elsewhere, BASE_URL)).toBeNull()
  })
})

describe("RutrackerAdapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.useFakeTimers({ toFake: ["setTimeout"] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const adapter = () => new RutrackerAdapter()
  const poll = (creds = CREDS) =>
    settle(adapter().fetchStats(BASE_URL, creds, "/forum/index.php", OPTIONS))

  it("throws without FlareSolverr", async () => {
    const spy = vi.spyOn(global, "fetch")
    await expect(adapter().fetchStats(BASE_URL, CREDS, "/forum/index.php")).rejects.toThrow(
      "RuTracker requires FlareSolverr"
    )
    expect(spy).not.toHaveBeenCalled()
  })

  it("logs in through the browser, then reuses the session cookie on the next poll", async () => {
    const sent = mockSolver()
    const creds = JSON.stringify({ username: "reuse", password: "right-p@ss&<" })

    const result = await poll(creds)

    expect(result).toMatchObject({
      kind: "overview",
      username: "someone",
      group: "User",
      remoteUserId: 1234,
      joinedDate: "2026-10-22",
      platformMeta: { statsEnabled: false, posts: 0 },
    })
    expect(described(sent)).toEqual([
      `GET ${BASE_URL}/forum/login.php`,
      "sessions.create",
      `GET ${BASE_URL}/forum/privmsg.php?folder=inbox +cookie`,
      `GET ${BASE_URL}/forum/login.php`,
      `POST ${BASE_URL}/forum/login.php`,
      `GET ${BASE_URL}/forum/profile.php?mode=viewprofile&u=1234`,
      "sessions.destroy",
    ])
    expect(sent[0].session).toBeUndefined()
    expect(sent[2].cookies).toEqual([{ name: "cf_clearance", value: "cleared" }])
    const loginForm = formOf(sent[4].url ?? "")
    expect(loginForm.fields).toEqual({
      redirect: "privmsg.php?folder=inbox",
      login_username: "reuse",
      login_password: "right-p@ss&<",
      login: "Вход",
    })
    expect(decodeURIComponent(sent[4].url ?? "")).toContain('accept-charset="windows-1251"')

    const again = mockSolver()
    await poll(creds)
    expect(described(again)).toEqual([
      `GET ${BASE_URL}/forum/login.php`,
      "sessions.create",
      `GET ${BASE_URL}/forum/privmsg.php?folder=inbox +cookie`,
      `GET ${BASE_URL}/forum/profile.php?mode=viewprofile&u=1234`,
      "sessions.destroy",
    ])
    expect(again[2].cookies).toEqual([
      { name: "cf_clearance", value: "cleared" },
      { name: "bb_session", value: "issued" },
    ])
  })

  it("adds the upload statistics and seeding count when the profile shows them", async () => {
    const sent = mockSolver({ profile: PROFILE_STATS_ON })

    const result = await poll()

    expect(result.platformMeta).toMatchObject({
      uploadedBytes: 193027526010024,
      rareUploadedBytes: 5511890221000,
      seedingCount: 100,
      seedingCapped: true,
    })
    const forms = sent.filter((r) => r.url?.startsWith("data:")).map((r) => formOf(r.url ?? ""))
    expect(forms.slice(1)).toEqual([
      {
        action: `${BASE_URL}/forum/ajax.php`,
        fields: { action: "get_traf_stats", user_id: "1234", form_token: TOKEN },
      },
      {
        action: `${BASE_URL}/forum/profile.php?mode=viewprofile&u=1234`,
        fields: { form_token: TOKEN, show_seeding: "1" },
      },
    ])
  })

  it("returns the overview when the statistics and seeding requests fail", async () => {
    mockSolver({
      profile: PROFILE_STATS_ON,
      ajax: { status: 500, body: "error" },
      seeding: { status: 403, body: CHALLENGE_HTML },
    })

    const result = await poll()

    expect(result.group).toBe("VIP (Adm)")
    expect(result.platformMeta).not.toHaveProperty("uploadedBytes")
    expect(result.platformMeta).not.toHaveProperty("seedingCount")
  })

  it("stores a captcha from the login as pending instead of posting the password again", async () => {
    const sent = mockSolver({ login: "captcha", captchaAnswer: "x7k2" })
    const creds = JSON.stringify({ username: "captcha", password: "right-p@ss&<" })

    const err = (await poll(creds).catch((e: unknown) => e)) as Error

    expect(sanitizeNetworkError(err.message)).toBe(
      "Enter the RuTracker captcha on the tracker page"
    )
    // The session the captcha belongs to stays open.
    expect(sent.some((r) => r.cmd === "sessions.destroy")).toBe(false)
    expect(await adapter().pendingCaptcha(BASE_URL, creds)).toMatchObject({
      imageUrl: "https://static.rutracker.cc/captcha/00001.jpg?1",
    })

    const again = mockSolver({ login: "captcha", captchaAnswer: "x7k2" })
    await expect(poll(creds)).rejects.toThrow("Enter the RuTracker captcha")
    expect(described(again).filter((d) => d.startsWith("POST"))).toEqual([])

    // A wrong answer is followed by a new captcha in the same session.
    const wrong = mockSolver({ login: "captcha", captchaAnswer: "x7k2" })
    await expect(settle(adapter().submitCaptcha(BASE_URL, creds, "nope"))).rejects.toThrow(
      "Wrong captcha, try the new one"
    )
    const wrongForm = formOf(wrong[0].url ?? "")
    expect(wrongForm.fields).toMatchObject({ cap_sid: "sid1", cap_code_abc1: "nope" })
    expect(await adapter().pendingCaptcha(BASE_URL, creds)).toMatchObject({
      imageUrl: "https://static.rutracker.cc/captcha/00001.jpg?1",
    })

    const right = mockSolver({ login: "captcha", captchaAnswer: "x7k2" })
    await settle(adapter().submitCaptcha(BASE_URL, creds, "x7k2"))
    expect(right.map((r) => r.cmd)).toEqual(["request.get", "sessions.destroy"])
    expect(await adapter().pendingCaptcha(BASE_URL, creds)).toBeNull()

    const after = mockSolver()
    await poll(creds)
    expect(after[2].cookies).toContainEqual({ name: "bb_session", value: "issued" })
  })

  it("takes a captcha the login page shows before posting anything", async () => {
    const sent = mockSolver({ captchaOnPage: true })
    const creds = JSON.stringify({ username: "on-page", password: "right-p@ss&<" })

    await expect(poll(creds)).rejects.toThrow("Enter the RuTracker captcha")

    expect(described(sent).filter((d) => d.startsWith("POST"))).toEqual([])
    expect(await adapter().pendingCaptcha(BASE_URL, creds)).not.toBeNull()
  })

  it("closes a captcha's session when it expires unanswered", async () => {
    const sent = mockSolver({ captchaOnPage: true })
    const creds = JSON.stringify({ username: "expires", password: "right-p@ss&<" })
    await poll(creds).catch(() => null)

    const later = Date.now() + 10 * 60 * 1000 + 1
    vi.spyOn(Date, "now").mockReturnValue(later)

    expect(await adapter().pendingCaptcha(BASE_URL, creds)).toBeNull()
    expect(sent.at(-1)?.cmd).toBe("sessions.destroy")
  })

  it("throws on an answer when no captcha is pending", async () => {
    mockSolver()
    await expect(
      settle(
        adapter().submitCaptcha(BASE_URL, JSON.stringify({ username: "none", password: "x" }), "a")
      )
    ).rejects.toThrow("No RuTracker captcha is pending")
  })

  it("reads a failed login as invalid credentials, without the password", async () => {
    mockSolver({ login: "refused" })
    const err = (await poll(JSON.stringify({ username: "wrong", password: "secret-pw" })).catch(
      (e: unknown) => e
    )) as Error
    expect(sanitizeNetworkError(err.message)).toBe("Invalid credentials")
    expect(err.message).not.toContain("secret-pw")
  })

  it("closes the browser session even when the poll fails", async () => {
    const sent = mockSolver({ login: "refused" })
    await poll(JSON.stringify({ username: "closes", password: "x" })).catch(() => null)
    expect(sent.at(-1)?.cmd).toBe("sessions.destroy")
  })

  it("lists every request of a poll in the debug view, never the password", async () => {
    mockSolver({ profile: PROFILE_STATS_ON })
    const creds = JSON.stringify({ username: "debug", password: "right-p@ss&<" })

    const calls = await settle(adapter().fetchRaw(BASE_URL, creds, "/forum/index.php", OPTIONS))

    expect(calls.map((c) => [c.label, c.error])).toEqual([
      ["Login", null],
      ["Account Header", null],
      ["Profile", null],
      ["Upload Statistics", null],
      ["Seeding List", null],
    ])
    expect(JSON.stringify(calls)).not.toContain("right-p@ss")
  })

  it("throws on a malformed credential instead of reporting a call", async () => {
    await expect(adapter().fetchRaw(BASE_URL, "{}", "/forum/index.php", OPTIONS)).rejects.toThrow()
  })
})
