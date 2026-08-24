# Graph Report - backend  (2026-08-23)

## Corpus Check
- 67 files · ~68,562 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1275 nodes · 2871 edges · 58 communities (56 shown, 2 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 104 edges (avg confidence: 0.86)
- Token cost: 0 input · 83,919 output

## Community Hubs (Navigation)
- Python Dependencies
- Smart-Ziw Agent Core
- MCP Server Management
- AI Document Enrichment
- Admin & Auth Bootstrap
- Database CRUD Layer
- Server Test Suite
- LLM Provider Tests
- Admin API Endpoints
- Browser & Temp-Mail Fetching
- LLM Client Adapters
- IADB Scraper
- Excel Utilities
- Project API
- Research Tests
- AI Project Filter
- Smart-Ziw Mentions
- LLM Model Discovery
- Research Pipeline
- African Union Scraper
- Guatemala Scraper
- Skill Store
- AG Portal Scraper
- Niger Marches Scraper
- Auth & Tokens
- Firecrawl MCP Client
- Research Evidence Corpus
- API Request Models
- Uploaded Screenshots
- Document Store
- Document Download & Extraction
- DevAid Scraper
- IsDB Scraper
- Skill Modules
- BCIE Scraper
- OAS Scraper
- BADEA Scraper
- Skill Registry & Tool Loop
- Comments & Notifications
- Country Presence Check
- Tender Templates
- World Bank Scraper
- Travel Allowance
- Geography Lookup
- Skill Registry Loading
- Anthropic Provider Tests
- EABR Scraper
- LLM Params & Tool Calls
- Auth & Comments Tests
- Project Deletion API
- Uploaded Images: Adidas
- Uploaded Images: Kali
- Skill State Helpers
- OpenAI Test Doubles
- Test Fixtures
- Custom Skills Init
- Utils Package

## God Nodes (most connected - your core abstractions)
1. `eProcScraper/backend/requirements.txt` - 115 edges
2. `get_db()` - 64 edges
3. `get_llm_call()` - 45 edges
4. `_reset_fake_openai()` - 33 edges
5. `run_research()` - 32 edges
6. `DocumentStore` - 27 edges
7. `_mk_admin()` - 27 edges
8. `discover_lightllm_models()` - 25 edges
9. `Skill` - 25 edges
10. `_strip_id()` - 24 edges

## Surprising Connections (you probably didn't know these)
- `get_llm_call()` --indirect_call--> `_call_llm()`  [INFERRED]
  smart_ziw_llm.py → smart_ziw_agent.py
- `test_anthropic_http_error_raises()` --indirect_call--> `get_llm_call()`  [INFERRED]
  tests/test_smart_ziw_llm.py → smart_ziw_llm.py
- `test_anthropic_json_mode_uses_safe_json_loads()` --indirect_call--> `get_llm_call()`  [INFERRED]
  tests/test_smart_ziw_llm.py → smart_ziw_llm.py
- `test_anthropic_preset_sends_subscription_key_header()` --indirect_call--> `get_llm_call()`  [INFERRED]
  tests/test_smart_ziw_llm.py → smart_ziw_llm.py
- `test_anthropic_provider_defaults_to_openai_path()` --indirect_call--> `get_llm_call()`  [INFERRED]
  tests/test_smart_ziw_llm.py → smart_ziw_llm.py

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Account switcher panel components** — eprocscraper_backend_uploads_74561e2f_0759_448e_8b3f_c088c04a46c6_screenshot_2026_01_24_192025_account_switcher_panel, eprocscraper_backend_uploads_74561e2f_0759_448e_8b3f_c088c04a46c6_screenshot_2026_01_24_192025_signed_in_account_profile, eprocscraper_backend_uploads_74561e2f_0759_448e_8b3f_c088c04a46c6_screenshot_2026_01_24_192025_manage_google_account_button, eprocscraper_backend_uploads_74561e2f_0759_448e_8b3f_c088c04a46c6_screenshot_2026_01_24_192025_recovery_email_prompt, eprocscraper_backend_uploads_74561e2f_0759_448e_8b3f_c088c04a46c6_screenshot_2026_01_24_192025_add_recovery_email_button, eprocscraper_backend_uploads_74561e2f_0759_448e_8b3f_c088c04a46c6_screenshot_2026_01_24_192025_other_accounts_list, eprocscraper_backend_uploads_74561e2f_0759_448e_8b3f_c088c04a46c6_screenshot_2026_01_24_192025_default_account_badge, eprocscraper_backend_uploads_74561e2f_0759_448e_8b3f_c088c04a46c6_screenshot_2026_01_24_192025_add_another_account_action, eprocscraper_backend_uploads_74561e2f_0759_448e_8b3f_c088c04a46c6_screenshot_2026_01_24_192025_sign_out_all_accounts_action [INFERRED 0.85]
- **Empty state content** — eprocscraper_backend_uploads_74561e2f_0759_448e_8b3f_c088c04a46c6_screenshot_2026_01_24_192025_empty_state_illustration, eprocscraper_backend_uploads_74561e2f_0759_448e_8b3f_c088c04a46c6_screenshot_2026_01_24_192025_no_subscriptions_message [INFERRED 0.85]
- **Adidas Padel Equipment Set** — eprocscraper_backend_uploads_b78fc370_daf2_4f32_8b20_ab2671a6fa7a_1771678772_adidas_metalbone_racket, eprocscraper_backend_uploads_b78fc370_daf2_4f32_8b20_ab2671a6fa7a_1771678772_adidas_drawstring_bag, eprocscraper_backend_uploads_b78fc370_daf2_4f32_8b20_ab2671a6fa7a_1771678772_adidas_brand [EXTRACTED 1.00]
- **Python 3.12 typing-extensions compatibility constraint** — eprocscraper_backend_requirements_pydantic, eprocscraper_backend_requirements_typing_extensions, eprocscraper_backend_requirements_mitmproxy [INFERRED 0.75]
- **FastAPI/starlette/sse-starlette version lock** — eprocscraper_backend_requirements_sse_starlette, eprocscraper_backend_requirements_fastapi, eprocscraper_backend_requirements_starlette [INFERRED 0.75]
- **Selenium typing-extensions version cap** — eprocscraper_backend_requirements_selenium, eprocscraper_backend_requirements_typing_extensions, eprocscraper_backend_requirements_mitmproxy [INFERRED 0.75]

## Communities (58 total, 2 thin omitted)

### Community 0 - "Python Dependencies"
Cohesion: 0.02
Nodes (116): eProcScraper/backend/requirements.txt, aioquic 1.2.0, annotated-types 0.7.0, anyio 4.11.0, apscheduler 3.11.3, argon2-cffi 25.1.0, argon2-cffi-bindings 25.1.0, asgiref 3.9.1 (+108 more)

### Community 1 - "Smart-Ziw Agent Core"
Cohesion: 0.05
Nodes (75): build_folder_name(), _build_references_from_research(), _coerce_skill_result(), _collect_helper_context(), _default_enrichment(), _enrich(), _escape_table_cell(), _format_date_for_folder() (+67 more)

### Community 2 - "MCP Server Management"
Cohesion: 0.06
Nodes (54): admin_create_mcp_server(), admin_delete_mcp_server(), admin_update_mcp_server(), _merge_mcp_env(), _normalize_mcp_server(), Return a copy of an MCP server config with env values replaced by ***., Preserve existing env values when the UI sends the redacted placeholder., Build a full server dict from a request body, optionally merging with an… (+46 more)

### Community 3 - "AI Document Enrichment"
Cohesion: 0.06
Nodes (56): analyze_documents(), _deepseek_request(), download_documents(), _download_file(), _extract_text(), _extract_text_from_docx(), _extract_text_from_pdf(), _parse_json_response() (+48 more)

### Community 4 - "Admin & Auth Bootstrap"
Cohesion: 0.09
Nodes (47): count_admin_users(), create_user_doc(), get_schedule(), list_users(), save_sync_log(), FastAPI, get, admin_create_user() (+39 more)

### Community 5 - "Database CRUD Layer"
Cohesion: 0.14
Nodes (45): create_comment(), create_notification(), create_notifications(), create_session(), delete_project_by_db_id(), delete_project_by_index(), delete_projects_by_db_ids(), delete_session() (+37 more)

### Community 6 - "Server Test Suite"
Cohesion: 0.11
Nodes (42): _format_smart_ziw_comment(), _config_with_secrets(), _FakeDB, _FakeRegistry, _FakeSkill, _mk_admin(), _mk_user(), _mk_user_no_admin() (+34 more)

### Community 7 - "LLM Provider Tests"
Cohesion: 0.12
Nodes (37): get_llm_call(), Return callable(system_prompt, user_prompt) -> dict (json_mode=True) or str…, _reset_fake_openai(), test_anthropic_preset_routes_to_messages_endpoint(), test_anthropic_preset_sends_subscription_key_header(), test_auto_uses_lightllm_when_base_url_set(), test_auto_with_blank_base_url_returns_env_call(), test_auto_with_blank_base_url_text_mode() (+29 more)

### Community 8 - "Admin API Endpoints"
Cohesion: 0.13
Nodes (34): get_smart_ziw_config(), save_smart_ziw_config(), post, put, Request, admin_delete_smart_ziw_skill(), admin_delete_user(), admin_discover_llm_models() (+26 more)

### Community 9 - "Browser & Temp-Mail Fetching"
Cohesion: 0.10
Nodes (19): Response, fetch_with_tempmail(), Path, Browser-based document fetcher with temporary-email registration fallback. When…, Best-effort browser fetcher that registers with a temp email when a document…, True if the page contains an email input and a password input., Return a locator for a register/sign-up link if one exists., Minimal mail.tm client: create an inbox and poll for messages. (+11 more)

### Community 10 - "LLM Client Adapters"
Cohesion: 0.09
Nodes (24): _call_llm(), _deepseek_client(), _safe_json_loads(), _anthropic_call(), _call_llm_text(), _env_json_call(), _env_text_call(), get_llm_provider_presets() (+16 more)

### Community 11 - "IADB Scraper"
Cohesion: 0.10
Nodes (27): accept_cookies(), check_for_tokens(), create_selenium_driver(), find_free_port(), main(), MWCTokenInterceptor, parse_powerbi_response(), IADB Procurement Page Scraper ============================== Uses mitmproxy as… (+19 more)

### Community 12 - "Excel Utilities"
Cohesion: 0.10
Nodes (26): _excel_safe_value(), get_search_regions(), load_existing_projects(), _load_from_json(), _load_keywords(), parse_date(), Shared Excel output and keyword configuration for all scrapers. Keywords and…, Fallback: load keywords from config.json. (+18 more)

### Community 13 - "Project API"
Cohesion: 0.14
Nodes (23): get_all_projects(), get_comment_metrics(), patch, _active_users_by_id(), CommentCreateRequest, DeadlineUpdate, DecisionUpdate, download_filtered_excel() (+15 more)

### Community 14 - "Research Tests"
Cohesion: 0.13
Nodes (24): is_document_url(), True only for http(s) URLs whose hostname resolves to public IPs., Run the adaptive research loop until convergence, dedupe exhaustion, or…, run_research(), url_is_safe(), _private_dns(), test_download_rejects_unsafe_url(), test_is_document_url_table() (+16 more)

### Community 15 - "AI Project Filter"
Cohesion: 0.11
Nodes (23): _build_batch_prompt(), _build_system_prompt(), filter_cybersecurity_projects(), AI-powered cybersecurity relevance filter using DeepSeek API. Sends ONLY…, Verify projects using DeepSeek AI with concurrent threads. Args: projects: list…, Build the final system prompt from config, falling back to defaults., Build a numbered list of projects for the AI to evaluate., Send a batch of projects to DeepSeek and return a list of verdict dicts. Each… (+15 more)

### Community 16 - "Smart-Ziw Mentions"
Cohesion: 0.27
Nodes (23): _answer_smart_ziw_mention(), _build_smart_ziw_chat_prompt(), _maybe_start_smart_ziw_chat(), _smart_ziw_bot_note(), _smart_ziw_mention_is_run_request(), _mk_comment(), _mk_project(), _mk_requester() (+15 more)

### Community 17 - "LLM Model Discovery"
Cohesion: 0.12
Nodes (24): _discover_anthropic_models(), discover_lightllm_models(), discover_models_for_preset(), _normalize_llm_models(), Stored LightLLM API key from the admin config; empty on any failure., Stored LightLLM subscription/secondary key from the admin config; empty on any…, Normalize a models listing into [{"id", "name"}] — deduped by id, sorted by…, Discover models via the Anthropic-compatible /models endpoint. (+16 more)

### Community 18 - "Research Pipeline"
Cohesion: 0.15
Nodes (22): _candidate_block(), _coerce_recap(), find_source(), _llm_json(), _looks_official(), _metadata_block(), Web research for the Smart-Ziw agent. Research is now performed through a…, At most 3 items whose full text goes into the final synthesis: captured… (+14 more)

### Community 19 - "African Union Scraper"
Cohesion: 0.23
Nodes (22): _build_ajax_payload(), _build_session(), _collect_listing_projects(), _date_is_actionable(), _detail_looks_open(), _extract_bid_number(), _extract_config_value(), _extract_detail_description() (+14 more)

### Community 20 - "Guatemala Scraper"
Cohesion: 0.15
Nodes (20): _build_params(), _enrich_project_descriptions(), _extract_project_description(), fetch_keyword(), _fetch_page(), main(), _normalize_description_text(), _parse_page() (+12 more)

### Community 21 - "Skill Store"
Cohesion: 0.15
Nodes (18): _custom_package_dir(), delete_custom_skill(), fetch_skill_from_url(), _load_json_skill_item(), _load_python_skill(), Any, Path, Admin-facing skill store for Smart-Ziw. Security model -------------- - All… (+10 more)

### Community 22 - "AG Portal Scraper"
Cohesion: 0.15
Nodes (18): _build_url(), _extract_ref_id(), fetch_keyword(), _fetch_page(), main(), _parse_date(), _parse_page(), _parse_row() (+10 more)

### Community 23 - "Niger Marches Scraper"
Cohesion: 0.18
Nodes (18): _enrich_descriptions(), _extract_post_id(), _fetch_detail_description(), fetch_first_page(), _normalize_whitespace(), _parse_card_date(), _parse_list_item(), BeautifulSoup (+10 more)

### Community 24 - "Auth & Tokens"
Cohesion: 0.14
Nodes (18): get_saved_searches(), get_user_by_id(), save_saved_searches(), update_user(), admin_reset_password(), AdminResetPasswordRequest, _auth_middleware(), change_password() (+10 more)

### Community 25 - "Firecrawl MCP Client"
Cohesion: 0.13
Nodes (14): _call_firecrawl_tool(), _extract_content(), _find_firecrawl_mcp_server(), firecrawl_mcp_available(), FirecrawlClient, Any, True when a Firecrawl MCP server with search+scrape is configured., Call a Firecrawl tool on the configured MCP server. Returns a dict; on failure… (+6 more)

### Community 26 - "Research Evidence Corpus"
Cohesion: 0.13
Nodes (10): _citation_lines(), CorpusItem, EvidenceCorpus, _items_block(), Ordered, deduplicated collection of sources with [n] citation numbering., Add a source; returns False if the URL is already in the corpus., test_corpus_dedupes_and_numbers(), test_corpus_dedupes_tracking_params_and_fragments() (+2 more)

### Community 27 - "API Request Models"
Cohesion: 0.12
Nodes (17): BaseModel, AdminUserUpdateRequest, ConfigUpdate, LlmModelsRequest, McpServerConfig, MentionItem, ProfileUpdateRequest, ProjectVoteUpdate (+9 more)

### Community 28 - "Uploaded Screenshots"
Cohesion: 0.14
Nodes (17): Account security, Account switcher panel, Add another account action, Add recovery email button, Default account badge, Empty state illustration (cat on books), Footer links (Privacy, Terms, Help, About), Google Account header (+9 more)

### Community 29 - "Document Store"
Cohesion: 0.15
Nodes (15): DocumentStore, Downloads tender documents into files/original/, recursively extracts archives…, Return relative paths of all files under files/., _download_documents(), _fake_get(), _public_dns(), test_document_store_builds_notes_in_memory(), test_download_blocks_redirect_to_private_url() (+7 more)

### Community 30 - "Document Download & Extraction"
Cohesion: 0.17
Nodes (10): _safe_slug(), _is_archive_path(), _is_under(), Path, Fallback that registers with a disposable email when the document is behind a…, Download one document into files/original/. Returns (path, error)., Extract text via markitdown, falling back to pdfplumber/openpyxl., Map a document path to its markdown extraction path under files/extracted/. (+2 more)

### Community 31 - "DevAid Scraper"
Cohesion: 0.20
Nodes (15): _build_payload(), _enrich_project_descriptions(), _extract_project_description(), fetch_keyword(), _normalize_description_text(), _parse_item(), Session, DevelopmentAid tender scraper. Searches… (+7 more)

### Community 32 - "IsDB Scraper"
Cohesion: 0.32
Nodes (15): _build_session(), _extract_description(), _extract_document_url(), _extract_field_map(), _extract_total_pages(), _fetch_detail(), _fetch_listing_page(), _is_active_status() (+7 more)

### Community 33 - "Skill Modules"
Cohesion: 0.22
Nodes (8): Base types and registry for Smart-Ziw skills (LLM tool-calling functions)., A tool-callable skill exposed to the Smart-Ziw LLM., Skill, Skill that converts a tender value to USD., Skill that downloads tender documents and extracts their text., Built-in Smart-Ziw skills package., Skill that returns the tender project metadata block., Skill that runs web research for a tender through a configured Firecrawl MCP…

### Community 34 - "BCIE Scraper"
Cohesion: 0.34
Nodes (14): _build_session(), _extract_detail_description(), _extract_detail_metadata(), _extract_document_url(), _extract_listing_page_urls(), _fetch_detail(), _fetch_html(), _normalize_space() (+6 more)

### Community 35 - "OAS Scraper"
Cohesion: 0.31
Nodes (13): RuntimeError, _bootstrap_session(), _build_grid_payload(), _build_session(), _is_active_notice(), _item_to_project(), _normalize_space(), _parse_iso_date() (+5 more)

### Community 36 - "BADEA Scraper"
Cohesion: 0.27
Nodes (13): get_search_keywords(), Always return fresh keywords from DB (or defaults)., _build_session(), _extract_date_fields(), _extract_max_pages(), _fetch_results_page(), _normalize_space(), _parse_results() (+5 more)

### Community 37 - "Skill Registry & Tool Loop"
Cohesion: 0.16
Nodes (8): Any, Holds skills and adapts them to OpenAI tool definitions., Return skills that are currently enabled., Return OpenAI-compatible tool definitions for enabled skills., Run a skill handler, catching exceptions and returning {"error": str}., Look up a skill by its id., SkillRegistry, Tool-calling loop that drives Smart-Ziw skills.

### Community 38 - "Comments & Notifications"
Cohesion: 0.19
Nodes (13): _broadcast_notification(), _build_reference_footer(), _build_thread_text(), _create_project_comment_and_notify(), _emit_user_notifications(), _post_smart_ziw_comment(), _project_comment_recipient_ids(), Path (+5 more)

### Community 39 - "Country Presence Check"
Cohesion: 0.24
Nodes (10): has_forvis_mazars_presence(), _normalize(), Forvis Mazars in-country presence checker for Smart-Ziw. The primary source is…, Return presence information for a tender country. Returns a dict with keys: -…, _check_forvis_presence(), Skill that checks Forvis Mazars in-country presence., test_presence_false_for_unknown_country(), test_presence_normalizes_case_and_whitespace() (+2 more)

### Community 40 - "Tender Templates"
Cohesion: 0.23
Nodes (9): Build an in-memory notes summary of captured documents., fill_template(), get_template(), Template loader/filler for the Smart-Ziw tender folder spec. Loads the official…, Return the raw template text for ``name``., Fill template ``name`` with ``context``. Missing variables render as empty…, test_fill_template_missing_variables_render_empty(), test_fill_template_replaces_placeholders() (+1 more)

### Community 41 - "World Bank Scraper"
Cohesion: 0.24
Nodes (11): format_date(), Convert various date formats to MM/DD/YYYY (e.g. '10/21/2024'). Handles: Unix…, fetch_notices(), main(), notice_to_project(), World Bank Procurement Notices Scraper. Uses the official POST API at:…, Fetch all procurement notices matching a keyword, with pagination. Uses POST…, Convert a raw API notice dict to our unified project dict. (+3 more)

### Community 42 - "Travel Allowance"
Cohesion: 0.26
Nodes (9): _estimate_travel(), Skill that estimates consultant travel costs., estimate_travel(), Travel-cost estimator for Smart-Ziw. Provides rough budget figures for…, Return a rough travel budget from Tunisia. Returns a dict with keys: -…, _region_for_country(), test_estimate_travel_allowance_calculation(), test_estimate_travel_no_country() (+1 more)

### Community 43 - "Geography Lookup"
Cohesion: 0.44
Nodes (8): seed_geography(), _build_continent_alias_map(), _build_country_alias_map(), build_lookup(), build_region_name_map(), infer_project_geography(), load_seed_data(), normalize_text()

### Community 44 - "Skill Registry Loading"
Cohesion: 0.20
Nodes (10): get_registry(), load_builtin_skills(), load_custom_skills(), Build a registry from built-ins overlaid with custom skills and DB state., Return built-in skills flagged as built_in=True and enabled=True., Reconstruct custom Skill objects from the `_type: smart_ziw_skills` DB doc., Rebuild a single custom Skill from its DB representation., _reconstruct_custom_skill() (+2 more)

### Community 45 - "Anthropic Provider Tests"
Cohesion: 0.25
Nodes (9): _anthropic_config(), _http_response(), test_anthropic_http_error_raises(), test_anthropic_json_mode_uses_safe_json_loads(), test_anthropic_provider_defaults_to_openai_path(), test_anthropic_provider_routes_to_messages_endpoint(), test_anthropic_uses_configured_temperature_and_max_tokens(), test_discover_anthropic_401_returns_auth_required() (+1 more)

### Community 46 - "EABR Scraper"
Cohesion: 0.42
Nodes (8): _build_session(), _fetch_listing(), _normalize_space(), _parse_date(), _parse_listing(), Session, EABR procurement notices scraper. Scrapes the rendered Oracle Procurement…, run_eabr_scraper()

### Community 47 - "LLM Params & Tool Calls"
Cohesion: 0.25
Nodes (8): _coerce_llm_params(), get_llm_tool_call(), Any, Merge a preset's defaults with user-supplied overrides. Returns a dict with…, Read llm_temperature/llm_max_tokens from config with safe clamping. Returns…, Return callable(messages, tools) -> raw response with .message.content and…, _resolve_preset_config(), test_anthropic_preset_tool_call_uses_requests()

### Community 48 - "Auth & Comments Tests"
Cohesion: 0.43
Nodes (6): _mk_user(), test_admin_cannot_self_deactivate(), test_admin_cannot_self_delete(), test_cannot_access_admin_without_admin_role(), test_create_and_list_comments_for_entity(), test_must_change_password_enforced()

### Community 49 - "Project Deletion API"
Cohesion: 0.40
Nodes (6): delete, bulk_delete_projects(), BulkProjectDeleteRequest, delete_project(), delete_project_by_id(), _queue_excel_export()

### Community 50 - "Uploaded Images: Adidas"
Cohesion: 0.40
Nodes (6): Adidas, Adidas Drawstring Bag, Adidas Metalbone Padel Racket, Metalbone, Padel, Product Photo: Adidas Metalbone Padel Racket and Bag

### Community 51 - "Uploaded Images: Kali"
Cohesion: 0.70
Nodes (5): gradient color scheme, Kali Linux, Kali Linux dragon logo, Kali Linux wallpaper artwork, KALI text typography

### Community 52 - "Skill State Helpers"
Cohesion: 0.50
Nodes (4): Serialize a Skill to the storage format used by save_skills_state., Serialize a custom Skill including reconstruction metadata., _skill_to_full_state(), _skill_to_state()

### Community 53 - "OpenAI Test Doubles"
Cohesion: 0.50
Nodes (3): _FakeOpenAI, _models_list_side_effect(), _response()

### Community 54 - "Test Fixtures"
Cohesion: 0.67
Nodes (3): fixture, _patch_stored_keys(), Avoid real DB lookups when tests exercise stored-key fallbacks.

## Knowledge Gaps
- **125 isolated node(s):** `Google Account header`, `Subscriptions title`, `Add recovery email button`, `Default account badge`, `Sign out of all accounts action` (+120 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `save_to_excel()` connect `Excel Utilities` to `Admin & Auth Bootstrap`, `World Bank Scraper`, `IADB Scraper`, `Project API`, `AI Project Filter`, `Guatemala Scraper`, `AG Portal Scraper`?**
  _High betweenness centrality (0.107) - this node is a cross-community bridge._
- **Why does `run()` connect `Smart-Ziw Agent Core` to `Admin & Auth Bootstrap`, `Comments & Notifications`, `LLM Provider Tests`, `Research Tests`, `LLM Params & Tool Calls`, `Research Pipeline`, `Firecrawl MCP Client`?**
  _High betweenness centrality (0.056) - this node is a cross-community bridge._
- **Why does `run_research()` connect `Research Tests` to `Smart-Ziw Agent Core`, `Skill Modules`, `Research Pipeline`, `Firecrawl MCP Client`, `Research Evidence Corpus`, `Document Store`, `Document Download & Extraction`?**
  _High betweenness centrality (0.051) - this node is a cross-community bridge._
- **Are the 31 inferred relationships involving `get_llm_call()` (e.g. with `RuntimeError` and `_call_llm()`) actually correct?**
  _`get_llm_call()` has 31 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Google Account header`, `Subscriptions title`, `Add recovery email button` to the rest of the system?**
  _125 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Python Dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.017241379310344827 - nodes in this community are weakly interconnected._
- **Should `Smart-Ziw Agent Core` be split into smaller, more focused modules?**
  _Cohesion score 0.05030864197530864 - nodes in this community are weakly interconnected._