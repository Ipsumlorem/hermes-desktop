import {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import {
  Send,
  Square as Stop,
  Slash,
  Paperclip,
  Mic,
  Languages,
} from "lucide-react";
import { isImeComposing } from "./keyboard";
import { useI18n } from "../../components/useI18n";
import { SLASH_COMMANDS, type SlashCommand } from "./slashCommands";
import { useInputHistory } from "./hooks/useInputHistory";
import { useVoiceInput } from "./hooks/useVoiceInput";
import {
  processFiles,
  filesFromClipboard,
  type AttachmentError,
} from "./attachmentUtils";
import { AttachmentChip } from "../../components/AttachmentChip";
import { ContextGauge, type ContextUsage } from "./ContextGauge";
import type { Attachment } from "../../../../shared/attachments";
import type {
  WritingAssistAutocompleteSettings,
  WritingAssistTranslationSettings,
} from "../../../../shared/writing-assist";

export interface ChatInputHandle {
  setText(text: string): void;
  clear(): void;
  focus(): void;
  /** Add files from external sources (drop overlay).  Returns errors. */
  addFiles(files: File[] | FileList): Promise<AttachmentError[]>;
}

export interface ChatInputReadiness {
  ok: boolean;
  code?: string;
  message?: string;
  fixLocation?: string;
  expectedEnvKey?: string;
}

interface ChatInputProps {
  isLoading: boolean;
  hasSession: boolean;
  sessionId?: string | null;
  remoteMode?: boolean;
  spellCheck?: boolean;
  autocompleteSettings?: WritingAssistAutocompleteSettings;
  translationSettings?: WritingAssistTranslationSettings;
  translationModelMissing?: boolean;
  /** Active profile — used to resolve the provider for voice transcription. */
  profile?: string;
  /** Context-window occupancy for the gauge; null until the first response. */
  contextUsage?: ContextUsage | null;
  /** Pre-send validation state. When `ok` is false, Send is disabled
   * and an inline banner explains why + how to fix it. */
  readiness?: ChatInputReadiness;
  /** Controls rendered inline in the bottom toolbar row (model + folder
   * pickers) so they share the composer's single bordered container. */
  toolbarExtras?: React.ReactNode;
  onSubmit: (text: string, attachments: Attachment[]) => void;
  onQuickAsk: (text: string, attachments: Attachment[]) => void;
  onAbort: () => void;
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(
  function ChatInput(
    {
      isLoading,
      hasSession,
      sessionId,
      remoteMode,
      spellCheck = true,
      autocompleteSettings,
      translationSettings,
      translationModelMissing = false,
      profile,
      contextUsage,
      readiness,
      toolbarExtras,
      onSubmit,
      onQuickAsk,
      onAbort,
    },
    ref,
  ): React.JSX.Element {
    const { t } = useI18n();
    const [input, setInput] = useState("");
    const [slashMenuOpen, setSlashMenuOpen] = useState(false);
    const [slashFilter, setSlashFilter] = useState("");
    const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
    const [autocompleteSelectedIndex, setAutocompleteSelectedIndex] =
      useState(0);
    const [inputFocused, setInputFocused] = useState(false);
    const [autocompleteDismissedKey, setAutocompleteDismissedKey] = useState<
      string | null
    >(null);
    const [llmAutocompleteSuggestion, setLlmAutocompleteSuggestion] =
      useState("");
    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const [attachmentError, setAttachmentError] = useState<string | null>(null);
    const [translationError, setTranslationError] = useState<string | null>(
      null,
    );
    const [translatingScope, setTranslatingScope] = useState<
      "draft" | "selection" | null
    >(null);
    const [selectionRange, setSelectionRange] = useState({
      start: 0,
      end: 0,
    });
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const slashMenuRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const autocompleteRequestIdRef = useRef(0);

    // Voice input. We snapshot whatever was already typed when recording starts
    // (`voiceBaseRef`), then rebuild the field as `base + livetranscript` on
    // every result so the SpeechRecognition path streams in live. The recorder
    // fallback delivers one final result on stop.
    const voiceBaseRef = useRef("");
    const handleVoiceResult = useCallback((text: string, isFinal: boolean) => {
      const base = voiceBaseRef.current;
      setInput(
        base.trim() ? (text ? `${base.trimEnd()} ${text}` : base) : text,
      );
      if (isFinal) inputRef.current?.focus();
    }, []);
    const voice = useVoiceInput(handleVoiceResult, profile);

    const autoResize = useCallback((): void => {
      const el = inputRef.current;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    }, []);

    const applyHistoryText = useCallback(
      (text: string): void => {
        setInput(text);
        requestAnimationFrame(() => {
          autoResize();
          inputRef.current?.setSelectionRange(text.length, text.length);
        });
      },
      [autoResize],
    );

    const history = useInputHistory({
      currentInput: input,
      applyText: applyHistoryText,
    });

    const formatError = useCallback(
      (err: AttachmentError): string => {
        switch (err.code) {
          case "too-many":
            return t("chat.attachTooMany");
          case "image-too-large":
            return t("chat.attachImageTooLarge", { name: err.filename });
          case "image-uncompressible":
            return t("chat.attachImageUncompressible", { name: err.filename });
          case "text-too-large":
            return t("chat.attachTextTooLarge", { name: err.filename });
          case "unsupported-type":
            return t("chat.attachUnsupported", { name: err.filename });
          case "read-failed":
            return t("chat.attachReadFailed", { name: err.filename });
          case "remote-mode-binary":
            return t("chat.attachRemoteModeBinary", { name: err.filename });
          default:
            return err.filename;
        }
      },
      [t],
    );

    const ingestFiles = useCallback(
      async (files: File[] | FileList): Promise<AttachmentError[]> => {
        const { attachments: added, errors } = await processFiles(
          files,
          attachments.length,
          {
            sessionId: sessionId || undefined,
            remoteMode: !!remoteMode,
          },
        );
        if (added.length > 0) {
          setAttachments((prev) => [...prev, ...added]);
        }
        if (errors.length > 0) {
          setAttachmentError(formatError(errors[0]));
        } else {
          setAttachmentError(null);
        }
        return errors;
      },
      [attachments.length, formatError, sessionId, remoteMode],
    );

    useImperativeHandle(
      ref,
      () => ({
        setText(text: string): void {
          setInput(text);
          requestAnimationFrame(() => {
            autoResize();
            if (inputRef.current) {
              inputRef.current.setSelectionRange(text.length, text.length);
              inputRef.current.focus();
            }
          });
        },
        clear(): void {
          setInput("");
          setAttachments([]);
          setAttachmentError(null);
          setTranslationError(null);
          setLlmAutocompleteSuggestion("");
          setSelectionRange({ start: 0, end: 0 });
          setAutocompleteSelectedIndex(0);
          setAutocompleteDismissedKey(null);
          setInputFocused(false);
          if (inputRef.current) inputRef.current.style.height = "auto";
        },
        focus(): void {
          inputRef.current?.focus();
        },
        addFiles(files: File[] | FileList): Promise<AttachmentError[]> {
          return ingestFiles(files);
        },
      }),
      [autoResize, ingestFiles],
    );

    // Refocus the textarea when a streaming response ends
    useEffect(() => {
      if (!isLoading) inputRef.current?.focus();
    }, [isLoading]);

    // Close slash menu on click outside
    useEffect(() => {
      if (!slashMenuOpen) return;
      function handleClickOutside(e: MouseEvent): void {
        if (
          slashMenuRef.current &&
          !slashMenuRef.current.contains(e.target as Node)
        ) {
          setSlashMenuOpen(false);
        }
      }
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }, [slashMenuOpen]);

    // Scroll active slash menu item into view
    useEffect(() => {
      if (!slashMenuOpen) return;
      const active = slashMenuRef.current?.querySelector(
        ".slash-menu-item-active",
      );
      active?.scrollIntoView({ block: "nearest" });
    }, [slashSelectedIndex, slashMenuOpen]);

    const filteredSlashCommands = useMemo(
      () =>
        slashMenuOpen
          ? SLASH_COMMANDS.filter((cmd) =>
              cmd.name.toLowerCase().startsWith(slashFilter.toLowerCase()),
            )
          : [],
      [slashMenuOpen, slashFilter],
    );

    const autocompleteEnabled =
      !!autocompleteSettings && autocompleteSettings.minChars > 0;
    const readinessOk = readiness?.ok !== false;
    const dictionaryAutocompleteEnabled =
      autocompleteSettings?.mode === "dictionary" &&
      autocompleteSettings.minChars > 0;
    const llmAutocompleteEnabled =
      autocompleteSettings?.mode === "llm" &&
      autocompleteSettings.minChars > 0;
    const autocompleteWords = useMemo(() => {
      const map = new Map<string, string>();
      for (const entry of history.entries) {
        for (const match of entry.matchAll(/[A-Za-zÀ-ÖØ-öø-ÿ][\w'-]{1,}/g)) {
          const word = match[0];
          const normalized = word.toLowerCase();
          if (!map.has(normalized)) {
            map.set(normalized, word);
          }
        }
      }
      return Array.from(map.values()).sort((a, b) => a.localeCompare(b));
    }, [history.entries]);
    const autocompleteRange = useMemo(() => {
      if (!autocompleteEnabled) return null;
      if (isLoading || !readinessOk) return null;
      if (slashMenuOpen) return null;
      if (selectionRange.start !== selectionRange.end) return null;
      if (selectionRange.start !== input.length) return null;
      const beforeCaret = input.slice(0, selectionRange.start);
      const match = beforeCaret.match(/(^|\s)([A-Za-zÀ-ÖØ-öø-ÿ][\w'-]*)$/);
      if (!match) return null;
      const prefix = match[2];
      if (prefix.length < autocompleteSettings.minChars) return null;
      return {
        start: beforeCaret.length - prefix.length,
        end: beforeCaret.length,
        prefix,
      };
    }, [
      autocompleteEnabled,
      autocompleteSettings,
      input,
      isLoading,
      readinessOk,
      selectionRange,
      slashMenuOpen,
    ]);
    const autocompleteContextKey = useMemo(
      () =>
        autocompleteRange
          ? `${autocompleteSettings?.mode || "off"}:${input}`
          : null,
      [autocompleteRange, autocompleteSettings?.mode, input],
    );
    useEffect(() => {
      if (!llmAutocompleteEnabled || !autocompleteRange || !inputFocused) {
        setLlmAutocompleteSuggestion("");
        return;
      }
      const requestId = ++autocompleteRequestIdRef.current;
      const timer = window.setTimeout(() => {
        void window.hermesAPI
          .suggestAutocomplete(input, autocompleteSettings.modelRef, profile)
          .then((suggestion) => {
            if (autocompleteRequestIdRef.current !== requestId) return;
            setLlmAutocompleteSuggestion(suggestion);
          })
          .catch(() => {
            if (autocompleteRequestIdRef.current !== requestId) return;
            setLlmAutocompleteSuggestion("");
          });
      }, autocompleteSettings.debounceMs);
      return () => {
        window.clearTimeout(timer);
      };
    }, [
      autocompleteRange,
      autocompleteSettings,
      input,
      inputFocused,
      llmAutocompleteEnabled,
      profile,
    ]);
    const autocompleteSuggestions = useMemo(() => {
      if (!autocompleteRange) return [];
      if (dictionaryAutocompleteEnabled) {
        const prefix = autocompleteRange.prefix.toLowerCase();
        return autocompleteWords
          .filter((word) => {
            const normalized = word.toLowerCase();
            return normalized.startsWith(prefix) && normalized !== prefix;
          })
          .slice(0, 5);
      }
      const normalizedSuggestion = llmAutocompleteSuggestion
        .replace(/\s+/g, " ")
        .trim();
      if (!normalizedSuggestion) return [];
      if (normalizedSuggestion.split(/\s+/).length > 12) return [];
      const lowerSuggestion = normalizedSuggestion.toLowerCase();
      const lowerInput = input.trimEnd().toLowerCase();
      if (
        lowerInput === lowerSuggestion ||
        lowerInput.endsWith(` ${lowerSuggestion}`)
      ) {
        return [];
      }
      return [normalizedSuggestion];
    }, [
      autocompleteRange,
      autocompleteWords,
      dictionaryAutocompleteEnabled,
      input,
      llmAutocompleteSuggestion,
    ]);
    const autocompleteOpen =
      inputFocused &&
      autocompleteSuggestions.length > 0 &&
      autocompleteDismissedKey !== autocompleteContextKey;

    const translationConfigured = translationSettings?.mode === "on_demand";
    const translationTargetConfigured =
      !!translationSettings?.targetLanguage.trim();
    const translationEnabled =
      translationConfigured && translationTargetConfigured;
    const hasSelection = selectionRange.end > selectionRange.start;
    const canTranslate =
      translationEnabled &&
      readinessOk &&
      !isLoading &&
      translatingScope === null;

    function clearAfterSend(text: string): void {
      history.push(text);
      setInput("");
      setAttachments([]);
      setAttachmentError(null);
      setTranslationError(null);
      setLlmAutocompleteSuggestion("");
      setSelectionRange({ start: 0, end: 0 });
      setAutocompleteSelectedIndex(0);
      setAutocompleteDismissedKey(null);
      if (inputRef.current) inputRef.current.style.height = "auto";
    }

    function handleSend(): void {
      const text = input.trim();
      const hasPayload = text.length > 0 || attachments.length > 0;
      if (!hasPayload) return;
      setSlashMenuOpen(false);
      const sendAttachments = attachments;
      clearAfterSend(text);
      onSubmit(text, sendAttachments);
    }

    function handleQuickAsk(): void {
      const text = input.trim();
      if (!text) return;
      const sendAttachments = attachments;
      clearAfterSend(text);
      onQuickAsk(text, sendAttachments);
    }

    function handleSlashSelect(cmd: SlashCommand): void {
      setSlashMenuOpen(false);
      // Local / info commands dispatch immediately — let parent route through onSubmit
      if (cmd.local || cmd.category === "info") {
        setInput("");
        if (inputRef.current) inputRef.current.style.height = "auto";
        onSubmit(cmd.name, []);
        return;
      }
      // Backend commands that take arguments: insert prefix and wait for the user
      setInput(cmd.name + " ");
      inputRef.current?.focus();
    }

    function handleInputChange(
      e: React.ChangeEvent<HTMLTextAreaElement>,
    ): void {
      const value = e.target.value;
      setInput(value);
      setTranslationError(null);
      setLlmAutocompleteSuggestion("");
      setAutocompleteSelectedIndex(0);
      setAutocompleteDismissedKey(null);
      setSelectionRange({
        start: e.target.selectionStart ?? 0,
        end: e.target.selectionEnd ?? 0,
      });

      const target = e.target;
      requestAnimationFrame(() => {
        target.style.height = "auto";
        target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
      });

      if (value.startsWith("/") && !value.includes(" ")) {
        const query = value.split(" ")[0];
        setSlashMenuOpen(true);
        setSlashFilter(query);
        setSlashSelectedIndex(0);
      } else if (slashMenuOpen) {
        setSlashMenuOpen(false);
      }
    }

    function updateSelectionFromTarget(target: HTMLTextAreaElement): void {
      setSelectionRange({
        start: target.selectionStart ?? 0,
        end: target.selectionEnd ?? 0,
      });
    }

    function replaceTextRange(
      start: number,
      end: number,
      replacement: string,
    ): void {
      const nextInput = `${input.slice(0, start)}${replacement}${input.slice(end)}`;
      setInput(nextInput);
      requestAnimationFrame(() => {
        autoResize();
        const nextCursor = start + replacement.length;
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(nextCursor, nextCursor);
      });
    }

    function acceptAutocomplete(word: string): void {
      let nextInput = input;
      if (dictionaryAutocompleteEnabled && autocompleteRange) {
        nextInput =
          `${input.slice(0, autocompleteRange.start)}${word} ` +
          input.slice(autocompleteRange.end);
      } else {
        const cleanWord = word.trimStart();
        const needsSpace =
          nextInput.length > 0 &&
          !/\s$/.test(nextInput) &&
          !/^[,.;:!?)]/.test(cleanWord);
        nextInput = `${nextInput}${needsSpace ? " " : ""}${cleanWord}`;
      }
      setInput(nextInput);
      requestAnimationFrame(() => {
        autoResize();
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(nextInput.length, nextInput.length);
      });
      setLlmAutocompleteSuggestion("");
      setAutocompleteSelectedIndex(0);
      setAutocompleteDismissedKey(null);
    }

    function normalizeTranslationError(error: unknown): string {
      if (!(error instanceof Error) || !error.message) {
        return t("chat.translationFailed");
      }
      if (error.message.includes("Choose a target language")) {
        return t("chat.translationDisabledTarget");
      }
      if (error.message.includes("selected translation model is incomplete")) {
        return t("chat.translationModelInvalid");
      }
      return error.message;
    }

    function translationButtonTitle(scope: "draft" | "selection"): string {
      if (translatingScope) return t("chat.translating");
      if (isLoading) return t("chat.translationDisabledBusy");
      if (!readinessOk) return t("chat.translationDisabledUnavailable");
      if (!translationTargetConfigured) return t("chat.translationDisabledTarget");
      if (scope === "selection" && !hasSelection) {
        return t("chat.translationDisabledSelection");
      }
      if (translationModelMissing) return t("chat.translationModelFallback");
      return scope === "selection"
        ? t("chat.translateSelection")
        : t("chat.translateDraft");
    }

    async function handleTranslate(scope: "draft" | "selection"): Promise<void> {
      if (!translationSettings || !translationConfigured) return;
      if (!translationTargetConfigured) {
        setTranslationError(t("chat.translationDisabledTarget"));
        return;
      }
      const start = scope === "selection" ? selectionRange.start : 0;
      const end = scope === "selection" ? selectionRange.end : input.length;
      const textToTranslate =
        scope === "selection" ? input.slice(start, end) : input;
      if (!textToTranslate.trim()) return;

      setTranslationError(null);
      setTranslatingScope(scope);
      try {
        const translated = await window.hermesAPI.translateText(
          textToTranslate,
          translationSettings.targetLanguage,
          translationSettings.preserveTone,
          translationSettings.sourceLanguage,
          translationSettings.modelRef,
          profile,
        );
        if (scope === "selection") {
          replaceTextRange(start, end, translated);
        } else {
          setInput(translated);
          setSelectionRange({
            start: translated.length,
            end: translated.length,
          });
          requestAnimationFrame(() => {
            autoResize();
            inputRef.current?.focus();
            inputRef.current?.setSelectionRange(
              translated.length,
              translated.length,
            );
          });
        }
      } catch (error) {
        setTranslationError(normalizeTranslationError(error));
      } finally {
        setTranslatingScope(null);
      }
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
      if (isImeComposing(e)) return;

      if (autocompleteOpen && autocompleteSuggestions.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setAutocompleteSelectedIndex((i) =>
            i < autocompleteSuggestions.length - 1 ? i + 1 : 0,
          );
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setAutocompleteSelectedIndex((i) =>
            i > 0 ? i - 1 : autocompleteSuggestions.length - 1,
          );
          return;
        }
        if (e.key === "Tab") {
          e.preventDefault();
          acceptAutocomplete(autocompleteSuggestions[autocompleteSelectedIndex]);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setAutocompleteDismissedKey(autocompleteContextKey);
          return;
        }
      }

      // Slash menu keyboard navigation
      if (slashMenuOpen && filteredSlashCommands.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSlashSelectedIndex((i) =>
            i < filteredSlashCommands.length - 1 ? i + 1 : 0,
          );
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSlashSelectedIndex((i) =>
            i > 0 ? i - 1 : filteredSlashCommands.length - 1,
          );
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          handleSlashSelect(filteredSlashCommands[slashSelectedIndex]);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setSlashMenuOpen(false);
          return;
        }
      }

      // History navigation: ArrowUp/Down when not in a multiline draft (or already navigating)
      if (!slashMenuOpen && (history.isNavigating() || !input.includes("\n"))) {
        if (e.key === "ArrowUp" && history.size() > 0) {
          if (history.recallPrev()) {
            e.preventDefault();
            return;
          }
        }
        if (e.key === "ArrowDown" && history.isNavigating()) {
          if (history.recallNext()) {
            e.preventDefault();
            return;
          }
        }
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    }

    function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>): void {
      const { files, hasText } = filesFromClipboard(e);
      if (files.length === 0) return;
      // If there's also text, let the textarea handle the text portion
      // normally; we still consume the files (browser delivers both).
      if (!hasText) e.preventDefault();
      void ingestFiles(files);
    }

    async function handleFileInputChange(
      e: React.ChangeEvent<HTMLInputElement>,
    ): Promise<void> {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      await ingestFiles(files);
      // Reset so the same file can be picked again later
      if (fileInputRef.current) fileInputRef.current.value = "";
    }

    function removeAttachment(id: string): void {
      setAttachments((prev) => prev.filter((a) => a.id !== id));
      setAttachmentError(null);
    }

    // Pre-send validation gate (#369): even with the queue model from
    // PR #379, we still block Send when readiness fails — a queued message
    // with a missing API key would just fail later. The !isLoading gate
    // is intentionally dropped here vs. the pre-merge version, so users
    // can queue messages while the agent is mid-response.
    const canSend =
      (input.trim().length > 0 || attachments.length > 0) && readinessOk;

    // Map fixLocation → user-facing call to action. The strings are
    // wrapped in i18n; the location ids come from main/validation.ts.
    function readinessFixLabel(loc: string | undefined): string {
      switch (loc) {
        case "providers":
          return t("chat.validation.fixInProviders");
        case "models":
          return t("chat.validation.fixInModels");
        case "gateway":
          return t("chat.validation.fixInGateway");
        case "setup":
          return t("chat.validation.fixInSetup");
        default:
          return "";
      }
    }

    return (
      <>
        {autocompleteOpen && (
          <div className="chat-autocomplete-menu">
            <div className="chat-autocomplete-header">
              {t("chat.autocompleteTitle")}
            </div>
            <div className="chat-autocomplete-list">
              {autocompleteSuggestions.map((word, i) => (
                <button
                  key={word}
                  className={`chat-autocomplete-item ${i === autocompleteSelectedIndex ? "chat-autocomplete-item-active" : ""}`}
                  onMouseEnter={() => setAutocompleteSelectedIndex(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    acceptAutocomplete(word);
                  }}
                  type="button"
                >
                  <span className="chat-autocomplete-word">{word}</span>
                </button>
              ))}
            </div>
            <div className="chat-autocomplete-footer">
              {t("chat.autocompleteHint")}
            </div>
          </div>
        )}
        {slashMenuOpen && filteredSlashCommands.length > 0 && (
          <div className="slash-menu" ref={slashMenuRef}>
            <div className="slash-menu-header">
              <Slash size={12} />
              {t("chat.commandsTitle")}
            </div>
            <div className="slash-menu-list">
              {filteredSlashCommands.map((cmd, i) => (
                <button
                  key={cmd.name}
                  className={`slash-menu-item ${i === slashSelectedIndex ? "slash-menu-item-active" : ""}`}
                  onMouseEnter={() => setSlashSelectedIndex(i)}
                  onClick={() => handleSlashSelect(cmd)}
                >
                  <span className="slash-menu-item-name">{cmd.name}</span>
                  <span className="slash-menu-item-desc">
                    {cmd.description}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        {!readinessOk && readiness?.message && (
          <div
            className="chat-readiness-banner"
            role="alert"
            data-testid="chat-readiness-banner"
          >
            <span className="chat-readiness-message">
              {readiness.expectedEnvKey
                ? t("chat.validation.missingKey", {
                    key: readiness.expectedEnvKey,
                  })
                : readiness.message}
            </span>
            {readiness.fixLocation && (
              <span className="chat-readiness-fix">
                {readinessFixLabel(readiness.fixLocation)}
              </span>
            )}
          </div>
        )}
        {(attachments.length > 0 || attachmentError) && (
          <div className="chat-attachment-strip">
            {attachments.map((att) => (
              <AttachmentChip
                key={att.id}
                attachment={att}
                onRemove={() => removeAttachment(att.id)}
              />
            ))}
            {attachmentError && (
              <div className="chat-attachment-error" role="alert">
                {attachmentError}
              </div>
            )}
          </div>
        )}
        {voice.error && (
          <div className="chat-attachment-error chat-voice-error" role="alert">
            {voice.error}
          </div>
        )}
        {translationError && (
          <div className="chat-attachment-error" role="alert">
            {translationError}
          </div>
        )}
        <div className="chat-input-wrapper">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={handleFileInputChange}
          />
          <textarea
            ref={inputRef}
            className="chat-input"
            placeholder={t("chat.typeMessage")}
            value={input}
            spellCheck={spellCheck}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onSelect={(e) => updateSelectionFromTarget(e.currentTarget)}
            onClick={(e) => updateSelectionFromTarget(e.currentTarget)}
            onKeyUp={(e) => updateSelectionFromTarget(e.currentTarget)}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            rows={1}
            autoFocus
          />
          <div className="chat-input-toolbar">
            <button
              className="chat-attach-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              title={t("chat.attach")}
              aria-label={t("chat.attach")}
              type="button"
            >
              <Paperclip size={16} />
            </button>
            {voice.supported && (
              <button
                className={`chat-mic-btn${
                  voice.recording ? " chat-mic-btn--recording" : ""
                }`}
                onClick={() => {
                  // Snapshot the current text so live results append to it.
                  if (!voice.recording && !voice.transcribing) {
                    voiceBaseRef.current = input;
                  }
                  voice.toggle();
                }}
                disabled={voice.transcribing}
                title={
                  voice.transcribing
                    ? t("chat.voiceTranscribing")
                    : voice.recording
                      ? t("chat.voiceStop")
                      : t("chat.voiceInput")
                }
                aria-label={
                  voice.recording ? t("chat.voiceStop") : t("chat.voiceInput")
                }
                aria-pressed={voice.recording}
                type="button"
              >
                <Mic size={16} />
              </button>
            )}
            {translationConfigured && (
              <>
                <span className="chat-input-toolbar-divider" aria-hidden />
                {hasSelection && (
                  <button
                    className="chat-attach-btn"
                    onClick={() => void handleTranslate("selection")}
                    disabled={!canTranslate}
                    title={translationButtonTitle("selection")}
                    aria-label={t("chat.translateSelection")}
                    type="button"
                  >
                    {translatingScope === "selection" ? (
                      <Stop size={16} />
                    ) : (
                      <Languages size={16} />
                    )}
                  </button>
                )}
                <button
                  className="chat-attach-btn"
                  onClick={() => void handleTranslate("draft")}
                  disabled={!canTranslate}
                  title={translationButtonTitle("draft")}
                  aria-label={t("chat.translateDraft")}
                  type="button"
                >
                  {translatingScope === "draft" ? (
                    <Stop size={16} />
                  ) : (
                    <Languages size={16} />
                  )}
                </button>
              </>
            )}
            {toolbarExtras && (
              <>
                <span className="chat-input-toolbar-divider" aria-hidden />
                {toolbarExtras}
              </>
            )}
            <div className="chat-input-toolbar-spacer" />
            {contextUsage && contextUsage.used > 0 && (
              <ContextGauge {...contextUsage} />
            )}
            {isLoading ? (
              <button
                className="chat-send-btn chat-stop-btn"
                onClick={onAbort}
                title={t("common.stop")}
              >
                <Stop size={14} />
              </button>
            ) : (
              <>
                {input.trim() && hasSession && (
                  <button
                    className="chat-btw-btn"
                    onClick={handleQuickAsk}
                    title={t("chat.quickAskTitle")}
                  >
                    💭
                  </button>
                )}
                <button
                  className="chat-send-btn"
                  onClick={handleSend}
                  disabled={!canSend}
                  title={t("chat.send")}
                >
                  <Send size={16} />
                </button>
              </>
            )}
          </div>
        </div>
      </>
    );
  },
);
