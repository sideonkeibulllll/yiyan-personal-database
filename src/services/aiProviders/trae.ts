/**
 * TRAE（字节跳动）提供商 —— 手机内直连适配
 *
 * ## 为什么能在手机上直连
 *
 * TRAE 官方客户端有手机版，对话端点对浏览器开放 CORS
 * （实测 `Access-Control-Allow-Origin: *`，允许的头里含 X-Jwt-Token /
 * X-App-Id / X-Tt-Logid），因此 WebView 里可以真流式调用，不需要任何
 * 中转服务。这也意味着退出 IP 就是手机本身的网络出口，与官方客户端
 * 同源，不会出现"机房 IP 异地登录"这类异常信号。
 *
 * ## 协议要点（全部来自对官方客户端的实测）
 *
 * - **认证**：`Authorization: Cloud-IDE-JWT <access_token>`，同时
 *   `X-Cloudide-Token` 与 `X-Ide-Token` 也要带同一个值，缺任一个都会被拒。
 * - **机器指纹**：`machine_id`（32 位 hex）与 `device_id` 每次对话必带，
 *   且不可重新生成——换机器需要重新登录。
 * - **请求体**：OpenAI 格式必须转成 SOLO 格式，详见 {@link transformToSOLO}。
 * - **响应**：非标准 SSE，事件名为 `output` / `token_usage` / `done` / `error`，
 *   正文在 `output.response`，思维链在 `output.reasoning_content`。
 * - **续期**：`refresh_token` 每次 ExchangeToken 都会轮换，刷完必须回写，
 *   否则下次启动就是一把废钥匙。
 *
 * @module services/aiProviders/trae
 */

// ── 端点与客户端常量 ──

import { Capacitor } from '@capacitor/core'

const TRAE_AGENT_HOST = 'https://trae-api-cn.mchost.guru'
const TRAE_OAUTH_HOST = 'https://api.trae.com.cn'
const TRAE_CHAT_PATH = '/api/agent/v3/llm_utils_chat'
const TRAE_EXCHANGE_PATH = '/cloudide/api/v3/trae/oauth/ExchangeToken'

/** OAuth 客户端 ID（随官方客户端分发，非用户凭据）。 */
const TRAE_CLIENT_ID = 'en1oxy7wnw8j9n'
/** 应用 ID，作为 `X-App-Id` 下发。 */
const TRAE_APP_ID = '6eefa01c-1036-4c7e-9ca5-d891f63bfcd8'
const TRAE_USER_AGENT = 'Trae/0.1.52'
const TRAE_IDE_VERSION = '0.1.52'
const TRAE_IDE_VERSION_CODE = '20260811'
const TRAE_OS_VERSION = 'macOS 15.7.4'
const TRAE_DEVICE_BRAND = 'Apple'

/**
 * SOLO 对话通道名。
 * 实测只有 `solo_work_lite` 有效，`work` / `solo` / `work_lite` 都会被拒。
 */
const TRAE_FUNCTION = 'solo_work_lite'

/** 提前多少毫秒判定 token 需要刷新。 */
const REFRESH_MARGIN_MS = 60_000

/** 控制面（刷新 token）请求超时。 */
const CONTROL_TIMEOUT_MS = 20_000

// ── 凭据 ──

/**
 * TRAE 凭据。整包以 JSON 字符串形式保存在设置里的 apiKey 字段，
 * 因为它是"一串东西"而不是单个 key。
 */
export interface TraeCredential {
  /** 访问令牌，放进 `Authorization: Cloud-IDE-JWT <token>`。 */
  access_token: string
  /** 刷新令牌，每次刷新都会轮换，必须回写。 */
  refresh_token: string
  /** 过期时间（毫秒时间戳字符串）。 */
  expires_at?: string
  /** 用户 ID，作为 `X-Uid` 下发。 */
  uid: string
  /** 昵称，仅用于展示。 */
  nickname?: string
  /** 机器指纹（32 位 hex），不可重新生成。 */
  machine_id: string
  /** 设备指纹，签到与对话都要带。 */
  device_id: string
}

/**
 * 解析用户粘贴的凭据。
 *
 * 容忍两种输入：完整的凭据 JSON，或只包含 `refresh_token` 的最小 JSON
 * （后者会在第一次调用时用刷新流程补齐其余字段——但 machine_id /
 * device_id 缺失时无法补齐，只能报错）。
 */
export function parseCredential(raw: string): TraeCredential | null {
  const text = raw.trim()
  if (text.length === 0) return null

  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(text) as Record<string, unknown>
  } catch {
    return null
  }

  const str = (key: string): string => {
    const value = obj[key]
    return typeof value === 'string' ? value.trim() : ''
  }

  const accessToken = str('access_token')
  const refreshToken = str('refresh_token')
  const uid = str('uid')
  const machineId = str('machine_id')
  const deviceId = str('device_id')
  const expiresAt = str('expires_at')
  const nickname = str('nickname')

  if (accessToken.length === 0 && refreshToken.length === 0) return null
  if (machineId.length === 0 || deviceId.length === 0) return null

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: expiresAt.length > 0 ? expiresAt : undefined,
    uid,
    nickname: nickname.length > 0 ? nickname : undefined,
    machine_id: machineId,
    device_id: deviceId,
  }
}

/** 把凭据序列化回 apiKey 字段的存储形式。 */
export function serializeCredential(credential: TraeCredential): string {
  return JSON.stringify(credential)
}

/**
 * 解析凭据列表。
 *
 * 支持两种输入：整段只有一个 JSON，或**一行一个 JSON**（多账号）。
 * 多账号时按轮询使用，用于分摊单账号的每日积分。
 */
export function parseCredentials(raw: string): TraeCredential[] {
  const text = raw.trim()
  if (text.length === 0) return []

  const single = parseCredential(text)
  if (single !== null) return [single]

  const list: TraeCredential[] = []
  for (const line of text.split(/\r?\n/)) {
    const credential = parseCredential(line)
    if (credential !== null) list.push(credential)
  }
  return list
}

/** 多账号轮询游标（仅在未指定账号时用于分摊额度，重启后从第一个开始）。 */
let credentialCursor = 0;

/**
 * 取一个可用凭据。
 *
 * - 指定了 `preferredUid` 且列表里有这个账号 → 用那个账号（手动指定，不轮换）
 * - 没指定 → 用列表第一个（保持可预期，避免"充值了却随机用到另一个号"）
 * - 只有一个账号 → 直接用
 */
export function pickCredential(raw: string, preferredUid?: string): TraeCredential | null {
  const list = parseCredentials(raw)
  if (list.length === 0) return null
  if (preferredUid !== undefined && preferredUid.length > 0) {
    const hit = list.find(credential => credential.uid === preferredUid)
    if (hit !== undefined) return hit
  }
  if (list.length === 1) return list[0]!
  // 未指定且有多个：轮询分摊，同时把游标留在模块内
  const chosen = list[credentialCursor % list.length]!
  credentialCursor = (credentialCursor + 1) % list.length
  return chosen
}

/**
 * 把轮换后的凭据写回原始多行文本（按 uid 定位那一行替换）。
 *
 * refresh_token 每次续期都会轮换，写错行会让另一个账号的凭据被覆盖，
 * 所以这里必须按 uid 精确匹配。
 */
export function replaceCredential(raw: string, updated: TraeCredential): string {
  const lines = raw.split(/\r?\n/)
  let replaced = false
  const next = lines.map((line) => {
    const credential = parseCredential(line)
    if (credential === null) return line
    if (credential.uid === updated.uid) {
      replaced = true
      return serializeCredential(updated)
    }
    return line
  })
  if (!replaced) next.push(serializeCredential(updated))
  return next.filter((line, index) => line.trim().length > 0 || index < next.length - 1).join('\n')
}

/** 凭据是否已经/即将过期。 */
export function isCredentialExpiring(credential: TraeCredential): boolean {
  if (credential.access_token.length === 0) return true
  const raw = credential.expires_at
  if (raw === undefined || raw.length === 0) return false
  const expires = Number.parseInt(raw, 10)
  if (!Number.isFinite(expires) || expires <= 0) return false
  return Date.now() > expires - REFRESH_MARGIN_MS
}

// ── token 刷新 ──

interface ExchangeResult {
  accessToken: string
  refreshToken: string
  expireAt: number
}

/**
 * 解析 ExchangeToken 响应。
 * 形如 `{ Result: { Token, TokenExpireAt, RefreshToken, RefreshExpireAt } }`，
 * 字段大小写两套都兼容。
 */
function parseExchangeResponse(data: Record<string, unknown>): ExchangeResult | null {
  const raw = data.Result ?? data.result
  if (typeof raw !== 'object' || raw === null) return null
  const result = raw as Record<string, unknown>

  const pick = (a: string, b: string): string => {
    const value = result[a] ?? result[b]
    return typeof value === 'string' ? value : ''
  }

  const token = pick('Token', 'token')
  const refresh = pick('RefreshToken', 'refreshToken')
  const expireAtRaw = result.TokenExpireAt ?? result.tokenExpireAt
  const expireAt = typeof expireAtRaw === 'number' ? expireAtRaw : Number(expireAtRaw)

  if (token.length === 0) return null
  return {
    accessToken: token,
    refreshToken: refresh.length > 0 ? refresh : '',
    expireAt: Number.isFinite(expireAt) && expireAt > 0 ? expireAt : 0,
  }
}

/**
 * 用 refresh_token 换一套新凭据。
 *
 * 注意：上游每次都会轮换 refresh_token，调用方**必须**把返回值写回设置，
 * 否则旧的 refresh_token 立即作废。
 */
export async function refreshCredential(
  credential: TraeCredential,
  fetchFn: typeof fetch = fetch,
): Promise<TraeCredential> {
  if (credential.refresh_token.length === 0) {
    throw new Error('TRAE 凭据缺少 refresh_token，无法自动续期');
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CONTROL_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetchFn(`${TRAE_OAUTH_HOST}${TRAE_EXCHANGE_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': TRAE_USER_AGENT,
      },
      body: JSON.stringify({
        ClientID: TRAE_CLIENT_ID,
        RefreshToken: credential.refresh_token,
        ClientSecret: '-',
        UserID: '',
      }),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`TRAE 续期失败（${response.status}）：${body.slice(0, 200)}`);
  }

  const data = (await response.json()) as Record<string, unknown>
  const result = parseExchangeResponse(data)
  if (result === null) throw new Error('TRAE 续期响应格式异常');

  return {
    ...credential,
    access_token: result.accessToken,
    refresh_token: result.refreshToken.length > 0 ? result.refreshToken : credential.refresh_token,
    expires_at: result.expireAt > 0 ? String(result.expireAt) : credential.expires_at,
  }
}

// ── 请求头 ──

/**
 * 构造对话请求头。
 *
 * ## 为什么只有三个头（重要）
 *
 * TRAE 的 CORS 预检返回的是**固定白名单**：
 * `Content-Type, Authorization, X-Tt-Logid, X-Tt-Env, X-Jwt-Token,
 *  X-Use-Ppe, Pragma, Cache-Control, Expires, X-App-Id`
 *
 * 官方客户端会带 `X-Cloudide-Token` / `X-Ide-Token` / `X-Uid` /
 * `X-Machine-Id` / `X-Device-Id` 等十几个自定义头，但这些**都不在白名单里**，
 * 浏览器会直接拒发实际请求（表现为 `TypeError: Failed to fetch`）。
 *
 * 实测结论：上游真正校验的 `app_version_code` 走的是 **body 字段（数字）**，
 * 不是 header。所以精简到三个头 + body 补字段就能 200，且能真流式。
 */
export function buildHeaders(credential: TraeCredential, stream: boolean): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: stream ? 'text/event-stream' : 'application/json',
    Authorization: `Cloud-IDE-JWT ${credential.access_token}`,
    'X-App-Id': TRAE_APP_ID,
  }
}

// ── 请求体转换 ──

/** 单条消息转换：content 字符串 → `[{type:'text',text}]`，tool_calls → function_call。 */
function transformMessage(message: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...message }

  if (result.role === 'assistant' && Array.isArray(result.tool_calls)) {
    const kept: unknown[] = []
    for (const raw of result.tool_calls) {
      if (typeof raw !== 'object' || raw === null) continue
      const call = { ...(raw as Record<string, unknown>) }
      if (typeof call.function === 'object' && call.function !== null) {
        call.function_call = call.function
        delete call.function
      }
      const fn = call.function_call as Record<string, unknown> | undefined
      if (fn === undefined || typeof fn.name !== 'string' || fn.name.trim().length === 0) continue
      kept.push(call)
    }
    if (kept.length > 0) {
      result.tool_calls = kept
    } else {
      delete result.tool_calls
    }
  }

  const content = result.content
  if (typeof content === 'string') {
    result.content = [{ type: 'text', text: content }]
  }

  return result
}

/** tool_choice 归一化：none 删 tools；对象形式转字符串；function 形式取 name。 */
function normalizeToolChoice(body: Record<string, unknown>): void {
  const choice = body.tool_choice
  if (choice === undefined) return

  if (choice === 'none') {
    delete body.tool_choice
    delete body.tools
    return
  }
  if (typeof choice === 'string') return
  if (typeof choice !== 'object' || choice === null) {
    delete body.tool_choice
    return
  }

  const obj = choice as Record<string, unknown>
  const type = typeof obj.type === 'string' ? obj.type : ''

  if (type === 'none') {
    delete body.tool_choice
    delete body.tools
    return
  }
  if (type === 'auto' || type === 'required') {
    body.tool_choice = type
    return
  }
  if (type === 'function') {
    const fn = obj.function as Record<string, unknown> | undefined
    const name = fn !== undefined && typeof fn.name === 'string' ? fn.name : ''
    if (name.length > 0) {
      body.tool_choice = name
      return
    }
  }
  delete body.tool_choice
}

/** tools[].function.parameters 从对象序列化成字符串（SOLO 要求）。 */
function normalizeTools(body: Record<string, unknown>): void {
  const tools = body.tools
  if (!Array.isArray(tools)) return

  for (const raw of tools) {
    if (typeof raw !== 'object' || raw === null) continue
    const tool = raw as Record<string, unknown>
    const fn = tool.function as Record<string, unknown> | undefined
    if (fn === undefined) continue
    const parameters = fn.parameters
    if (typeof parameters === 'object' && parameters !== null) {
      fn.parameters = JSON.stringify(parameters)
    }
  }
}

/**
 * OpenAI 请求体 → SOLO 请求体。
 *
 * 改写规则（对官方客户端的实测结果）：
 * 1. `stream` 强制为 `true`，非流式由调用方自己聚合
 * 2. 补 `function: 'solo_work_lite'`
 * 3. messages 逐条转换
 * 4. `model` 同时写进 `config_name` 与 `model`
 * 5. `tool_choice` 归一化
 * 6. `tools[].function.parameters` 序列化成字符串
 */
export function transformToSOLO(
  openaiBody: Record<string, unknown>,
  channel: string = TRAE_FUNCTION,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    ...openaiBody,
    stream: true,
    function: channel.length > 0 ? channel : TRAE_FUNCTION,
    // 上游做参数绑定校验，缺了直接 400（binding: expr_path=app_version_code）。
    // 注意必须是数字，传字符串会报 unmarshal 错误。
    app_version_code: Number(TRAE_IDE_VERSION_CODE),
  }

  if (Array.isArray(body.messages)) {
    body.messages = (body.messages as unknown[]).map((message) =>
      typeof message === 'object' && message !== null
        ? transformMessage(message as Record<string, unknown>)
        : message,
    )
  }

  const model = typeof body.model === 'string' ? body.model : ''
  const baseModel = model.includes('__') ? model.split('__')[0]! : model
  const configName = baseModel.length > 0 ? baseModel : 'glm-5.2'
  body.config_name = configName
  body.model = configName

  normalizeToolChoice(body)
  normalizeTools(body)

  return body
}

// ── SSE 解析 ──

/** 解析后的单条 SOLO 事件。 */
interface TraeEvent {
  event: string
  response?: string
  reasoning?: string
  toolCalls?: unknown[]
  finishReason?: string
  errorCode?: number
  errorMessage?: string
}

/** SOLO tool_calls 归一化：function_call → function，去掉 SOLO 专有字段。 */
function normalizeToolCalls(calls: unknown[]): unknown[] {
  return calls.map((raw) => {
    if (typeof raw !== 'object' || raw === null) return raw
    const call = { ...(raw as Record<string, unknown>) }
    if (typeof call.function_call === 'object' && call.function_call !== null) {
      call.function = { ...(call.function_call as Record<string, unknown>) }
      delete call.function_call
    }
    const fn = call.function
    if (typeof fn === 'object' && fn !== null) {
      const target = fn as Record<string, unknown>
      delete target.namespace
      delete target.partial_arguments
    }
    return call
  })
}

/** 解析一条 `event:` + `data:` 组合。 */
function parseEvent(eventName: string, dataLine: string): TraeEvent | undefined {
  const event = eventName.trim()
  if (event.length === 0) return undefined
  if (dataLine.length === 0) return { event }

  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(dataLine) as Record<string, unknown>
  } catch {
    return { event }
  }

  const result: TraeEvent = { event }

  switch (event) {
    case 'output': {
      if (typeof raw.response === 'string') result.response = raw.response
      if (typeof raw.reasoning_content === 'string') result.reasoning = raw.reasoning_content
      if (Array.isArray(raw.tool_calls)) result.toolCalls = normalizeToolCalls(raw.tool_calls)
      break
    }
    case 'done': {
      if (typeof raw.finish_reason === 'string') result.finishReason = raw.finish_reason
      break
    }
    case 'error': {
      if (typeof raw.code === 'number') result.errorCode = raw.code
      if (typeof raw.message === 'string') result.errorMessage = raw.message
      break
    }
    default:
      break
  }

  return result
}

// ── 调用入口 ──

export interface TraeStreamCallbacks {
  onReasoning: (chunk: string) => void
  onContent: (chunk: string) => void
  onToolCall?: (deltas: unknown[]) => void
}

export interface TraeChatOptions {
  credential: TraeCredential
  model: string
  body: Record<string, unknown>
  callbacks: TraeStreamCallbacks
  signal?: AbortSignal
  /** 流式请传 `window.CapacitorWebFetch`，非流式用默认 fetch 即可。 */
  fetchFn?: typeof fetch
  /** 凭据被刷新时的回写回调（refresh_token 会轮换，不回写就废）。 */
  onCredentialRotated?: (credential: TraeCredential) => void
}

/** 判断错误信息是否值得重试一次（换完 token 重发）。 */
function isAuthFailure(status: number, message: string): boolean {
  if (status === 401 || status === 403) return true
  return /token|expired|unauthor|jwt/i.test(message)
}

/**
 * 一次完整的 TRAE 对话（流式推进回调）。
 *
 * 内部会自动处理 token 过期：命中 401/403 时刷新一次并重试，
 * 刷新结果通过 `onCredentialRotated` 交给调用方持久化。
 */
export async function streamTraeChat(options: TraeChatOptions): Promise<{ finishReason: string | null }> {
  const { model, body, callbacks, signal } = options
  const fetchFn = options.fetchFn ?? fetch

  let credential = options.credential
  let rotated = false

  // 过期就先刷，省一次失败的往返
  if (isCredentialExpiring(credential)) {
    credential = await refreshCredential(credential, fetch)
    options.onCredentialRotated?.(credential)
    rotated = true
  }

  const payload = transformToSOLO({ ...body, model }, TRAE_FUNCTION)
  const url = `${TRAE_AGENT_HOST}${TRAE_CHAT_PATH}`

  const send = async (): Promise<Response> =>
    fetchFn(url, {
      method: 'POST',
      headers: buildHeaders(credential, true),
      body: JSON.stringify(payload),
      signal,
    })

  let response = await send()

  if (!response.ok && (response.status === 401 || response.status === 403) && !rotated) {
    const probe = await response.text().catch(() => '')
    if (isAuthFailure(response.status, probe)) {
      credential = await refreshCredential(credential, fetch)
      options.onCredentialRotated?.(credential)
      rotated = true
      response = await send()
    } else {
      throw new Error(`TRAE 请求失败（${response.status}）：${probe.slice(0, 200)}`)
    }
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`TRAE 请求失败（${response.status}）：${text.slice(0, 300)}`)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('无法读取 TRAE 响应流')

  const decoder = new TextDecoder()
  let buffer = ''
  let eventName = ''
  let dataLine = ''
  let finishReason: string | null = null
  let sawAnyContent = false

  const flush = (): void => {
    if (eventName.length === 0 && dataLine.length === 0) return
    const parsed = parseEvent(eventName, dataLine)
    eventName = ''
    dataLine = ''
    if (parsed === undefined) return

    if (parsed.event === 'error') {
      const code = parsed.errorCode ?? 0
      const message = parsed.errorMessage ?? '未知错误'
      throw new Error(`TRAE 流内错误（${code}）：${message}`)
    }
    if (parsed.reasoning !== undefined && parsed.reasoning.length > 0) {
      callbacks.onReasoning(parsed.reasoning)
    }
    if (parsed.response !== undefined && parsed.response.length > 0) {
      sawAnyContent = true
      callbacks.onContent(parsed.response)
    }
    if (parsed.toolCalls !== undefined && parsed.toolCalls.length > 0) {
      callbacks.onToolCall?.(parsed.toolCalls)
    }
    if (parsed.finishReason !== undefined) {
      finishReason = parsed.finishReason
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const rawLine of lines) {
      const line = rawLine.replace(/\r$/, '')
      if (line.length === 0) {
        flush()
        continue
      }
      if (line.startsWith('event:')) {
        const next = line.slice(6).trim()
        if (next.length > 0) {
          if (eventName.length > 0) flush()
          eventName = next
        }
        continue
      }
      if (line.startsWith('data:')) {
        dataLine += line.slice(5).trim()
        continue
      }
      // 其余字段（id: / retry: 等）忽略
    }
  }
  flush()

  if (finishReason === null && sawAnyContent) finishReason = 'stop'
  if (finishReason === null && !sawAnyContent) {
    throw new Error('TRAE 返回了空结果（可能是当日额度已用完）')
  }

  return { finishReason }
}

export interface TraeCallOptions {
  credential: TraeCredential
  model: string
  /** 与 OpenAI Chat Completions 请求体同构的字段。 */
  body: Record<string, unknown>
  signal?: AbortSignal
  onCredentialRotated?: (credential: TraeCredential) => void
}

/**
 * 非流式调用：内部仍然走 SSE，收到完整体后一次性返回。
 * 供 `ai.chat()` 这类只需要最终文本的场景使用。
 */
export async function traeChat(options: TraeCallOptions): Promise<string> {
  let content = ''
  await streamTraeChat({
    credential: options.credential,
    model: options.model,
    body: options.body,
    signal: options.signal,
    onCredentialRotated: options.onCredentialRotated,
    callbacks: {
      onReasoning: () => {},
      onContent: (chunk) => {
        content += chunk
      },
    },
  })
  return content
}

// ── 积分与签到 ──

const TRAE_UG_HOST = 'https://api.trae.cn'
const TRAE_ENT_USAGE_PATH = '/trae/api/v2/pay/ide_user_ent_usage'
const TRAE_CHECKIN_STATUS_PATH = '/trae/api/v2/ug/checkin_credits/status'
const TRAE_CHECKIN_CLAIM_PATH = '/trae/api/v2/ug/checkin_credits/claim'

/** 积分余额与今日签到状态。 */
export interface TraeCreditsInfo {
  /** 总积分余额。 */
  totalBalance: number
  /** 今日是否已签到。 */
  checkedIn: boolean
  /** 今日签到可得/已得积分。 */
  dailyCredits: number
  /** 签到功能是否可用。 */
  checkinEnabled: boolean
}

/** 用简化头访问 Ug（签到/积分）端点——实测这三个接口都接受。 */
function ugHeaders(credential: TraeCredential): Record<string, string> {
  const minimal: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': TRAE_USER_AGENT,
    Authorization: `Cloud-IDE-JWT ${credential.access_token}`,
    'X-User-Region': 'CN',
    'X-Device-Id': credential.device_id,
  }
  // Web / Electron：受 CORS 白名单限制，只能带精简头（多了会 Failed to fetch）。
  // 原生端走 CapacitorHttp（无预检），补上官方客户端同款头 —— claim 比 status 校验更严
  // （设备指纹 / machine_id 绑定），缺头正是「积分能查、签到没反应」的常见原因。
  if (Capacitor.getPlatform() === 'web') return minimal
  return {
    ...minimal,
    'X-Cloudide-Token': credential.access_token,
    'X-Uid': credential.uid,
    'X-App-Id': TRAE_APP_ID,
    'X-Machine-Id': credential.machine_id,
    'X-Device-Type': 'macos',
    'X-Os-Version': TRAE_OS_VERSION,
    'X-Ide-Version': TRAE_IDE_VERSION,
    'X-Ide-Version-Code': TRAE_IDE_VERSION_CODE,
    'X-Request-Id': `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
  }
}

/** 统一的 POST 封装：带超时，失败抛出可读错误。 */
async function ugPost(
  credential: TraeCredential,
  path: string,
  body: Record<string, unknown>,
  fetchFn: typeof fetch,
): Promise<Record<string, unknown>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CONTROL_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetchFn(`${TRAE_UG_HOST}${path}`, {
      method: 'POST',
      headers: ugHeaders(credential),
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }

  const text = await response.text().catch(() => '')
  if (!response.ok) {
    throw new Error(`TRAE 积分接口失败（${response.status}）：${text.slice(0, 200)}`)
  }
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error('TRAE 积分接口返回了无法解析的内容')
  }
}

/** 上游响应里的业务码（缺省视为 0＝成功）。 */
function readCode(body: Record<string, unknown>): number {
  const raw = body.code ?? body.err_code ?? body.errno
  const code = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(code) ? code : 0
}

/** 上游响应里的提示语（不同接口字段名不一致）。 */
function readMessage(body: Record<string, unknown>): string {
  for (const key of ['message', 'msg', 'err_msg', 'error']) {
    const raw = body[key]
    if (typeof raw === 'string' && raw.trim().length > 0) return raw.trim()
  }
  return ''
}

/** 已知业务码的人话解释（9074 是早高峰限流，实测有效）。 */
const TRAE_CODE_HINTS: Record<number, string> = {
  9074: '当前参与用户太多，请晚点再试',
}

/** 拼一条可读的错误文案：上游 message + 已知解释 + code。 */
function describeCode(code: number, message: string): string {
  const hint = TRAE_CODE_HINTS[code] ?? ''
  const parts = [message, hint].filter(text => text.length > 0)
  return parts.length > 0 ? `${parts.join('；')}（code ${code}）` : `code ${code}`
}

/**
 * 从响应里抠数值：顶层与 `data` 各找一遍，字段名按优先级尝试。
 * 签到接口的「本次获得」字段在不同版本叫 credits_gained / gained_credits /
 * reward / work_credits —— v3.6.2 只读了 credits，所以永远显示 0 积分。
 */
function readNumber(body: Record<string, unknown>, keys: string[]): number {
  const data = (body.data as Record<string, unknown> | undefined) ?? {}
  for (const source of [body, data]) {
    for (const key of keys) {
      const raw = source[key]
      if (raw === undefined || raw === null) continue
      const num = typeof raw === 'number' ? raw : Number(raw)
      if (Number.isFinite(num)) return num
    }
  }
  return 0
}

/** 读取积分余额与今日签到状态。 */
export async function fetchCreditsInfo(
  credential: TraeCredential,
  fetchFn: typeof fetch = fetch,
): Promise<TraeCreditsInfo> {
  const balanceBody = await ugPost(credential, TRAE_ENT_USAGE_PATH, { require_usage: true, req_source: 2 }, fetchFn)
  const totalRaw = balanceBody.total_balance ?? balanceBody.totalBalance
  const totalBalance = typeof totalRaw === 'number' ? totalRaw : Number(totalRaw) || 0

  const statusBody = await ugPost(credential, TRAE_CHECKIN_STATUS_PATH, {}, fetchFn)
  const statusCode = readCode(statusBody)
  if (statusCode !== 0) {
    throw new Error(`签到状态查询失败：${describeCode(statusCode, readMessage(statusBody))}`)
  }
  const statusData = (statusBody.data as Record<string, unknown> | undefined) ?? {}
  const checkedIn = statusBody.checked_in === true
    || statusBody.did_checked_in === true
    || statusData.checked_in === true
    || statusData.did_checked_in === true
  const dailyCredits = readNumber(statusBody, ['credits', 'daily_credits', 'checkin_credits'])

  return {
    totalBalance,
    checkedIn,
    dailyCredits,
    checkinEnabled: statusBody.enable !== false,
  }
}

/** 单次签到结果。 */
export interface TraeClaimResult {
  /** 上游业务码为 0 才算成功 */
  ok: boolean
  code: number
  /** 本次获得的积分（已签到/失败时为 0） */
  credits: number
  /** 成功时的上游提示，失败时的可读原因 */
  message: string
}

/** 领取今日签到积分。 */
export async function claimCheckin(
  credential: TraeCredential,
  fetchFn: typeof fetch = fetch,
): Promise<TraeClaimResult> {
  const body = await ugPost(credential, TRAE_CHECKIN_CLAIM_PATH, {}, fetchFn)
  const code = readCode(body)
  const credits = readNumber(body, [
    'credits_gained',
    'gained_credits',
    'reward',
    'work_credits',
    'credits',
    'extra_credits',
  ])
  const message = readMessage(body)
  return {
    ok: code === 0,
    code,
    credits: code === 0 ? credits : 0,
    message: code === 0 ? message : describeCode(code, message),
  }
}

/** 单个账号的积分视图（多账号批量查询用）。 */
export interface TraeAccountCredits extends TraeCreditsInfo {
  uid: string
  /** 展示名：昵称，缺省用 uid 后 6 位。 */
  label: string
  /** 查询失败时的错误文案。 */
  error?: string
}

/** 账号展示名。 */
function accountLabel(credential: TraeCredential): string {
  if (credential.nickname !== undefined && credential.nickname.length > 0) return credential.nickname
  return `账号 ${credential.uid.slice(-6)}`
}

/**
 * 批量读取所有账号的积分与签到状态。
 *
 * 单个账号失败不影响其它账号，失败信息写进该项的 `error`。
 */
export async function fetchAllCredits(
  raw: string,
  fetchFn: typeof fetch = fetch,
): Promise<TraeAccountCredits[]> {
  const list = parseCredentials(raw)
  const out: TraeAccountCredits[] = []
  for (const credential of list) {
    const label = accountLabel(credential)
    try {
      const info = await fetchCreditsInfo(credential, fetchFn)
      out.push({ ...info, uid: credential.uid, label })
    } catch (error) {
      out.push({
        uid: credential.uid,
        label,
        totalBalance: 0,
        checkedIn: false,
        dailyCredits: 0,
        checkinEnabled: false,
        error: error instanceof Error ? error.message : '查询失败',
      })
    }
  }
  return out
}

/** 批量签到结果。 */
export interface TraeCheckinResult {
  uid: string
  label: string
  /** 今日原本就已签到（没发起领取） */
  skipped: boolean
  /** 本次领取是否成功（skipped 也算 ok） */
  ok: boolean
  credits: number
  message: string
}

/**
 * 一键签到所有账号（顺序执行，避免并发触发风控）。
 *
 * 先查状态再领：已签到的账号直接跳过，省一次 claim（高峰期限流很敏感）。
 * 每个账号都会带独立的 ok / message —— UI 据此逐条显示，不再把失败说成「今日已签」。
 */
export async function claimAllCheckin(
  raw: string,
  fetchFn: typeof fetch = fetch,
): Promise<TraeCheckinResult[]> {
  const list = parseCredentials(raw)
  const out: TraeCheckinResult[] = []
  for (const credential of list) {
    const label = accountLabel(credential)
    try {
      const info = await fetchCreditsInfo(credential, fetchFn)
      if (info.checkedIn) {
        out.push({ uid: credential.uid, label, skipped: true, ok: true, credits: 0, message: '今日已签到' })
        continue
      }
      const result = await claimCheckin(credential, fetchFn)
      out.push({
        uid: credential.uid,
        label,
        skipped: false,
        ok: result.ok,
        credits: result.credits,
        message: result.message,
      })
    } catch (error) {
      out.push({
        uid: credential.uid,
        label,
        skipped: false,
        ok: false,
        credits: 0,
        message: error instanceof Error ? error.message : '签到失败',
      })
    }
  }
  return out
}
