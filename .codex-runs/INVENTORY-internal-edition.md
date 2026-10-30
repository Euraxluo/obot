# Obot 企业内部版净化盘点

盘点基线：分支 `skin/ztocc-theme`，HEAD `3bdcc216817f29d342dd08ba5e7fd0caab160809`。

本清单只覆盖开源版的用户/设备配额、license/entitlement、社区注册/升级提示、电话回家/产品遥测和自动检查更新。`LICENSE` 与源码版权头不在移除范围。

## 确认移除：用户/设备配额 enforcement

| 文件:行 | 限制点 | 移除波及面 |
| --- | --- | --- |
| `pkg/gateway/client/client.go:27-33` | 默认用户数和设备数各为 100，作为未配置 license provider 时的兜底配额。 | Go：删除默认配额常量；测试：`pkg/license/*_limit_test.go` 和 gateway 配额测试不再适用；API/OpenAPI：版本响应不再暴露 `userLimit`/`deviceLimit`。 |
| `pkg/gateway/client/auth.go:18-125` | `UserDecorator` 解析 license-derived `UserLimit`，并把它传给登录时的 `EnsureIdentity`；新用户达到配额会阻止认证建号。 | Go：删除 `UserLimit`、`UserLimitProvider`、解析和调用参数；认证/RBAC 保留；API：登录不再因配额返回 403；测试：`auth_user_limit_test.go` 删除/改为无上限建号语义。 |
| `pkg/gateway/client/identity.go:118-124,222,319,622-669` | `EnsureIdentity`、SCIM 建号和 `createUser` 的计数、advisory lock、403 用户上限错误。 | Go：身份同步、SCIM、OAuth、API key、bootstrap 调用签名需要同步调整；测试：`identity_user_limit*_test.go`、依赖旧签名的测试改写或删除；API：不再产生用户配额错误。 |
| `pkg/gateway/client/device.go:20-170` | `EnrollDevice` 根据 `DeviceLimit` 计数、锁定并拒绝新设备。 | Go：设备 enrollment 保留密钥校验、防接管和数据库写入，删除配额计数/锁/错误；测试：`device_limit_test.go` 删除或改为任意数量设备均可创建；API：`POST /api/mdm/enroll` 不再返回旧配额 403。 |
| `pkg/gateway/client/scimuser.go:79-84,583-592` | SCIM 建号选项携带 `UserLimit`，最终由 `createUser` enforcement。 | Go：SCIM 仍保留全部 provisioning、group、audit 行为，只去掉配额参数；测试：SCIM harness/concurrency/setup 测试去掉配额夹具。 |
| `pkg/scim/handler.go:55-58,366-386` | SCIM 环境接口要求解析用户上限，并在 POST Users 前拒绝无效/耗尽配额。 | Go/API：SCIM endpoint 改为直接创建用户；SCIM 测试需要验证功能与错误语义不受配额影响。 |
| `pkg/scim/environment.go:21-44` | 运行时 SCIM 环境持有 license-derived `UserLimitProvider`。 | Go：构造函数和实现删除 user-limit 依赖；`pkg/api/router/router.go:159` 调用链同步调整；SCIM 功能保留。 |
| `pkg/api/handlers/deviceenroll.go:21-76` | API handler 解析 `DeviceLimit`，并以 provider 错误阻止 enrollment。 | Go/API：保留 enrollment credential、PKIX/算法校验和设备写入，删除 provider 依赖与无效配额判断；`deviceenroll_test.go` 改写。 |
| `pkg/api/authn/noauth.go:26-39`、`pkg/bootstrap/bootstrap.go:180-191` | 以 `UserLimit{Unlimited:true}` 绕过配额，说明无认证和 bootstrap 也依赖旧签名。 | Go：保留无认证/bootstrap 的身份创建功能，改用无配额 API；相关测试只验证创建成功。 |
| `pkg/gateway/client/{auth_user_limit,device_limit,identity_user_limit,identity_user_limit_postgres}*_test.go` | 直接验证 100/自定义/并发用户或设备配额 enforcement。 | 测试：删除旧限制测试，补到受影响的登录、SCIM、MDM 流程的无上限语义验证。 |
| `pkg/api/handlers/localauth.go:86-90`、`pkg/gateway/client/localauth.go:22-24,77-125` | bootstrap 创建第二个本地账号会返回 `ErrBootstrapLocalAuthUserLimit`。 | 这是首次安装初始化不变量，不是 license 配额；当前列为“待确认/保留”，不在本轮删除。 |

## 确认移除：license/entitlement 后端体系

| 文件:行 | 限制点 | 移除波及面 |
| --- | --- | --- |
| `pkg/license/provider.go`、`pkg/license/entitlements.go` 及 `pkg/license/*_test.go` | Keygen license key、机器指纹、刷新、entitlement、用户/设备配额、provider violation 和 path gate 的完整后端体系。 | Go：服务组装、dispatcher、controller、handler、SCIM 和 model proxy 构造签名需要简化；测试：license 专项测试删除；API/OpenAPI：license 状态、entitlement、violation 字段与路由删除或重生成。 |
| `pkg/api/handlers/license.go`、`pkg/api/handlers/communitylicense.go` 及对应测试 | `GET/PUT/POST/DELETE /api/license` 和 `/api/license/community`，含 Keygen 校验、社区注册和许可证状态。 | API：删除 license/community endpoint；authz、password-change allowlist、router、OpenAPI 和前端 API client 同步删除；测试与 mock 删除。 |
| `pkg/api/handlers/version.go:28-46,83-169,188-201` | `/api/version` 依赖 license provider 计算 enterprise/community、entitlements、violations、user/device limit、valid license 和 model proxy 可用性。 | API：保留运行时能力、用户/设备计数和真实 feature flags，删除 edition/license/limit 字段；前端 `Version` 类型和所有引用同步调整。 |
| `pkg/api/handlers/authprovider.go:39-46,250,326-335` | 配置 auth provider 前用 `RequireEntitlements`/`MissingEntitlements` 阻止真实认证功能。 | Go/API：认证授权和 SCIM 校验保留，移除 entitlement gate；测试：认证 provider 配置测试改为默认可用。 |
| `pkg/api/handlers/providers/authproviders.go:16,40-48`、`modelproviders.go:11,36-46` | provider status 把缺失 entitlement 返回给前端，模型供应商也被 license status 包装。 | Go/API：保留配置参数和模型同步状态，`MissingEntitlements` 永远不再参与响应；模型供应商页保持可用。 |
| `pkg/api/handlers/availablemodels.go:18-27,44`、`pkg/api/handlers/modelprovider.go:17-25,35-38` | model provider/available models handler 依赖 license provider，可能把真实模型功能绑定到 license 状态。 | Go/API：删除 gate 依赖，保留 provider 配置、模型同步和 `/api/model-providers`；测试改为无 entitlement 也可读。 |
| `pkg/api/authz/authz.go:78-81,355` | license API 的 admin/owner/user 路由授权条目。 | authz：删除 license 路由规则；其余认证授权/RBAC 规则不变；对应 authz 测试删除。 |
| `pkg/api/server/server.go:28,68,89,108,441-452` | HTTP server 持有 `ProviderEntitlementGate`，并把 `/api/license` 放入密码变更期间的允许读取列表。 | Go：删除 provider gate 和 license allowlist；普通认证、密码修改、SCIM 路径保持。 |
| `pkg/api/router/router.go:36-46,82-105,120-159,135-139` | router 注入 license provider 到 version、model/auth provider、device enrollment、MCP tester/model proxy、SCIM，并注册 license 路由。 | Go：删除 license handler/upgrade community issuer；各功能改为内部版默认可用；SCIM 构造保持。 |
| `pkg/services/config.go:48,230-231,279,950,1080,1194-1202,1265-1266,1298` | 服务启动创建 license provider、version checker、telemetry consent/publisher，并把 license 注入多个服务。 | Go：删除 license/telemetry/update-check 初始化与字段；启动不再访问 Keygen/Upgrade Server；模型数据刷新配置另列待确认。 |
| `pkg/gateway/server/dispatcher/dispatcher.go:17,37-54` | provider dispatcher 持有 license provider。 | Go：删除该依赖；auth provider discovery/configuration 保留。 |
| `pkg/controller/routes.go:45-46`、`pkg/controller/everyreplicaroutes.go:31`、`pkg/controller/controller.go:681`、`pkg/controller/handlers/provider/provider.go:50-74,270-300`、`pkg/controller/handlers/providerconfigurationchange/providerconfigurationchange.go:19,38-89` | controller/provider sync 透传 license provider，配置状态读取时计算 entitlement。 | Go：删除透传和 status entitlement 计算；provider registry、配置变更、SCIM setup、LLM gateway sync 保留。 |
| `apiclient/types/modelprovider.go:11,18`、`apiclient/types/zz_generated.deepcopy.go:955-986` | API 类型暴露 `RequiredEntitlements`/`MissingEntitlements`。 | API/OpenAPI：若资源 schema 不再需要 entitlement，删除字段并重新生成 deepcopy/OpenAPI； provider manifest 的其他配置字段保留。 |
| `apiclient/types/mcptester.go:98`、`pkg/api/handlers/mcptester.go:134`、`pkg/mcptester/modelproxy.go` 及 `mcptester_modelproxy.go` | MCP Tester 外部 model proxy 使用 license key/许可证错误语义。 | “待确认”：这部分可能是外部服务的调用凭证而非本地 gate；在确认内部部署是否仍使用 model proxy 前不动。 |

## 确认移除：前端 license/community/upgrade 表面

| 文件:行 | 限制点 | 移除波及面 |
| --- | --- | --- |
| `ui/user/src/lib/components/admin/license/` 全部 | CommunitySignupBanner/Form/Panel、LicenseProviderDialog、LicenseResolveDialog、LicenseViolationBanner、UserLimitNotice。 | UI：整体删除；组件 spec 删除；所有 import、dismiss、license violation、user-limit notice 引用清理。 |
| `ui/user/src/routes/admin/license/+page.ts`、`ui/user/src/routes/admin/platform/LicenseView.svelte` | license 路由/平台 License tab、Keygen key、社区注册、用户/设备配额展示和升级/contact-sales 文案。 | UI：删除 license route/view；平台设置保留 branding、notifications、model proxy、registry、git credentials 等真实功能；tab 默认值和 route loader 更新。 |
| `ui/user/src/lib/components/Layout.svelte:54,64-77,226-229,365-368,432-498,638-666` | enterprise/community logo 分支、license store、user limit/violation banner、community signup banner 和 dismiss 状态。 | UI：保留 SCIMSetupBanner、SCIMTokenExpiryBanner、app notification；删除 license/community banner 与 dismiss；默认 logo 分支固定为内部版。 |
| `ui/user/src/lib/components/mcp/tester/Tester.svelte:5,27,91-100,336-381` | MCP Tester Chat 在无 community/enterprise entitlement 时显示社区注册表单。 | UI：删除注册分支，Chat 按真实 `chatAvailable`/不可用状态渲染；Tester 功能和模型 provider 链接保留。 |
| `ui/user/src/routes/identity-access/UsersView.svelte:8,11,17-18,28,110,187-208` | 用户页显示用户上限、license/community 分支并挂载 UserLimitNotice。 | UI：删除配额展示和 telemetry deferral 依赖；用户表、SCIM 状态、角色/RBAC 操作保留。 |
| `ui/user/src/routes/identity-access/AuthProvidersView.svelte:15,28,1081-1088` | provider 缺失 license 时打开 LicenseProviderDialog/社区注册。 | UI：删除 dialog 和注册回调；保留 auth provider 配置、切换、SCIM setup/expiry 提示。 |
| `ui/user/src/lib/components/mcp/McpServerActions.svelte:15,192-194,244-251,341-347,492-517`、`ui/user/src/lib/components/vmcps/VMcpCardActions.svelte:5,34-36,58-107`、`ui/user/src/lib/components/vmcps/VMcpList.svelte:11,86-88,180-190` | license violation 会禁用 MCP/vMCP 连接、测试和启动。 | UI：删除 entitlement 禁用条件，保留真正的访问控制、配置状态、OAuth 和 server ownership 判断。 |
| `ui/user/src/lib/constants.ts:445-450`、`ui/user/src/lib/utils.ts:356-370` | enterprise/community/model-provider entitlement 常量、社区 banner 文案、用户上限计算。 | UI：删除内部版不再需要的常量/函数；保留与普通 MCP、SCIM、RBAC 相关常量。 |
| `ui/user/src/lib/stores/license.svelte.ts`、`ui/user/src/lib/stores/index.ts`、`ui/user/src/lib/services/user/operations.ts:1506-1510`、`ui/user/src/lib/services/admin/operations.ts:2252-2277`、相关 `types.ts` | license store、API client license 类型/方法和社区注册方法。 | API client：删除 GET/PUT/POST/DELETE license 方法、类型、store 和 mock handler；所有调用清理。 |
| `ui/user/src/lib/services/user/types.ts:1166-1192`、相关 `Version` mock/spec | Version 类型暴露 enterprise/community/entitlements/violations/limits/upgrade 字段。 | API client/UI：删除 edition/license/limit/update-check 字段；保留运行时能力和真实计数（如仍有页面需要）。 |
| `ui/user/messages/platform/{en,ja,ko,zh-CN}.json`、`ui/user/messages/core/{en,ja,ko,zh-CN}.json`、`ui/user/messages/models/{en,ja,ko,zh-CN}.json` | license、community signup、contact support、upgrade/pricing/limit 和 license error 文案。 | i18n：删除无引用 key 并重新编译 Paraglide；SCIM、市场、审批、数据权限等文案保留。 |

## 确认移除：电话回家、产品遥测、自动检查更新

| 文件:行 | 限制点 | 移除波及面 |
| --- | --- | --- |
| `pkg/producttelemetry/` 全部 | 采集安装 ID、license machine ID、版本、用户/设备/MCP/LLM/扫描/执行数据并按日发送到 Upgrade Server。 | Go：删除 publisher/client/request/consent；API/OpenAPI：删除 telemetry consent 类型、handler、路由和 authz；UI：删除设置页 Product Analytics、首次启动 consent、store、测试和 i18n。 |
| `pkg/api/handlers/producttelemetryconsent.go` 及测试、`pkg/api/authz/producttelemetryconsent_test.go`、`pkg/cli/server_analytics_test.go` | 产品遥测 consent API 和 CLI 环境变量测试。 | API/测试：删除 endpoint、授权规则、CLI 解析项和测试。 |
| `pkg/upgrade/client.go`、`pkg/upgrade/version_checker.go` 及对应测试 | Upgrade Server 安装 ID、版本检查和自动升级提示。 | Go：删除 version checker 与 upgrade client；`/api/version` 不再返回 `upgradeAvailable/latestVersion`；Profile 升级提示和相关 UI 类型/spec 删除。 |
| `ui/user/src/routes/+layout.ts:68-74,111-145`、`ui/user/src/routes/admin/platform/+page.ts:1-115`、`ui/user/src/routes/admin/platform/SettingsView.svelte:10-129,220-251`、`ui/user/src/lib/components/admin/SetupSplashContent.svelte:8-68` | 根布局、平台设置和首次启动流程读取/编辑 product analytics consent。 | UI：删除 consent 请求、设置区块、首次启动询问和 deferral；EULA、通知、模型代理、registry、git credential 等继续工作。 |
| `ui/user/src/lib/stores/productTelemetryConsent.svelte.ts`、相关 tests/mocks/layout tests | telemetry consent 状态和测试 mock。 | UI 测试/mock：删除无关断言和 handler，避免残留 `/api/product-telemetry-consent` 引用。 |

## 待确认：本轮不动

| 文件:行 | 原因 |
| --- | --- |
| `pkg/api/handlers/mcptester_modelproxy.go:20-96`、`pkg/mcptester/modelproxy.go:27`、`apiclient/types/mcptester.go:98` | 读取 license key 并传给外部 model service；需要确认内部部署是否仍使用该外部服务。它可能是外部服务认证凭证，不只是开源版 UI gate。 |
| `pkg/api/handlers/modelproxy.go:96`、`pkg/api/handlers/modelproxy_test.go` | model proxy 通过 license provider 读取 key；与上项绑定，先不动。 |
| `pkg/services/config.go` 的 `LLMGatewayModelDataURL` 默认值（当前指向 `https://upgrade-server.obot.ai/v1/model-data`）及 `pkg/llmengine/modeldata.go` 相关路径 | 这是模型价格/能力数据刷新，可能是功能性数据源，不等同于产品遥测；需确认是否改为内网/本地数据。 |
| `apiclient/types/apppreferences.go:16-22`、`ui/user/src/lib/stores/appPreferences.svelte.ts:12-61`、`ui/user/src/lib/components/navbar/BetaLogo.svelte`、平台 Branding 相关 i18n | enterprise/community logo 是可配置 branding 能力，当前 ZTOCC 主题把它们指向同一内部 logo；先保留数据契约，运行时 edition 分支会改为默认内部版。 |
| `ui/user/src/routes/inventory/EnrollmentConfigDownload.svelte:77-83,429-430` 及 `inventory_enforcement_*check_for_updates` 文案 | 这里检查的是 MDM/Sentry 资产版本，不是 Obot server 自动升级；属于设备治理功能，先保留。 |
| `pkg/jwt/persistent/persistent.go:60` | 注释提到 community license，但所在代码是持久 token/OAuth 流程；需确认是否只是历史注释，先不动。 |
| `README.md:159-161`、`.github/workflows/*enterprise*`、`Dockerfile:2,58,74` | 发行/构建文档和 enterprise provider 镜像仍有开源上游语义；本轮先聚焦运行时与 UI，待内部镜像/供应商发布方式确认后再处理。 |

## 明确保留

- `LICENSE` 文件和源码版权头原样保留。
- 认证、授权/RBAC、审计日志、SCIM 全部功能，包括 `SCIMSetupBanner` 与 `SCIMTokenExpiryBanner`。
- 市场、审批、数据权限、设备扫描/执行等已交付功能。
- 普通请求速率限制、分页/请求体大小限制、LLM budget、MCP 资源限制等与 edition license 无关的运行安全边界。
