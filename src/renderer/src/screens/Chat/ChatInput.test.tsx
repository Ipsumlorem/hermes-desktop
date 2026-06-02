import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatInput } from "./ChatInput";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

afterEach(() => {
  vi.useRealTimers();
});

describe("ChatInput", () => {
  it("passes spellCheck=true to the composer textarea", () => {
    render(
      <ChatInput
        isLoading={false}
        hasSession={false}
        spellCheck={true}
        onSubmit={() => {}}
        onQuickAsk={() => {}}
        onAbort={() => {}}
      />,
    );

    expect(screen.getByRole("textbox")).toHaveAttribute("spellcheck", "true");
  });

  it("passes spellCheck=false to the composer textarea", () => {
    render(
      <ChatInput
        isLoading={false}
        hasSession={false}
        spellCheck={false}
        onSubmit={() => {}}
        onQuickAsk={() => {}}
        onAbort={() => {}}
      />,
    );

    expect(screen.getByRole("textbox")).toHaveAttribute("spellcheck", "false");
  });

  it("shows the draft translation action when on-demand translation is enabled", () => {
    render(
      <ChatInput
        isLoading={false}
        hasSession={false}
        translationSettings={{
          mode: "on_demand",
          modelRef: "",
          sourceLanguage: "auto",
          targetLanguage: "German",
          preserveTone: true,
        }}
        onSubmit={() => {}}
        onQuickAsk={() => {}}
        onAbort={() => {}}
      />,
    );

    expect(
      screen.getByRole("button", { name: "chat.translateDraft" }),
    ).toBeInTheDocument();
  });

  it("keeps the draft translation action visible but disabled without a target language", () => {
    render(
      <ChatInput
        isLoading={false}
        hasSession={false}
        translationSettings={{
          mode: "on_demand",
          modelRef: "",
          sourceLanguage: "auto",
          targetLanguage: "",
          preserveTone: true,
        }}
        onSubmit={() => {}}
        onQuickAsk={() => {}}
        onAbort={() => {}}
      />,
    );

    expect(
      screen.getByRole("button", { name: "chat.translateDraft" }),
    ).toBeDisabled();
  });

  it("shows the selection translation action after selecting text", () => {
    render(
      <ChatInput
        isLoading={false}
        hasSession={false}
        translationSettings={{
          mode: "on_demand",
          modelRef: "",
          sourceLanguage: "auto",
          targetLanguage: "German",
          preserveTone: true,
        }}
        onSubmit={() => {}}
        onQuickAsk={() => {}}
        onAbort={() => {}}
      />,
    );

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hello world" } });
    textarea.setSelectionRange(0, 5);
    fireEvent.select(textarea);

    expect(
      screen.getByRole("button", { name: "chat.translateSelection" }),
    ).toBeInTheDocument();
  });

  it("shows a fallback title when the saved translation model is missing", () => {
    render(
      <ChatInput
        isLoading={false}
        hasSession={false}
        translationSettings={{
          mode: "on_demand",
          modelRef: "missing-model",
          sourceLanguage: "auto",
          targetLanguage: "German",
          preserveTone: true,
        }}
        translationModelMissing={true}
        onSubmit={() => {}}
        onQuickAsk={() => {}}
        onAbort={() => {}}
      />,
    );

    expect(
      screen.getByRole("button", { name: "chat.translateDraft" }),
    ).toHaveAttribute("title", "chat.translationModelFallback");
  });

  it("shows dictionary autocomplete suggestions from sent drafts", () => {
    render(
      <ChatInput
        isLoading={false}
        hasSession={false}
        autocompleteSettings={{
          mode: "dictionary",
          modelRef: "",
          debounceMs: 250,
          minChars: 2,
        }}
        onSubmit={() => {}}
        onQuickAsk={() => {}}
        onAbort={() => {}}
      />,
    );

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "hello world" } });
    fireEvent.click(screen.getByRole("button", { name: "chat.send" }));
    fireEvent.change(textarea, { target: { value: "he" } });

    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("accepts a dictionary autocomplete suggestion with Tab", () => {
    render(
      <ChatInput
        isLoading={false}
        hasSession={false}
        autocompleteSettings={{
          mode: "dictionary",
          modelRef: "",
          debounceMs: 250,
          minChars: 2,
        }}
        onSubmit={() => {}}
        onQuickAsk={() => {}}
        onAbort={() => {}}
      />,
    );

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hello world" } });
    fireEvent.click(screen.getByRole("button", { name: "chat.send" }));
    fireEvent.change(textarea, { target: { value: "he" } });
    fireEvent.keyDown(textarea, { key: "Tab" });

    expect(textarea.value).toBe("hello ");
  });

  it("shows llm autocomplete suggestions after debounce", async () => {
    vi.useFakeTimers();
    window.hermesAPI = {
      suggestAutocomplete: vi.fn().mockResolvedValue("there"),
    } as unknown as typeof window.hermesAPI;

    render(
      <ChatInput
        isLoading={false}
        hasSession={false}
        autocompleteSettings={{
          mode: "llm",
          modelRef: "model-1",
          debounceMs: 50,
          minChars: 2,
        }}
        onSubmit={() => {}}
        onQuickAsk={() => {}}
        onAbort={() => {}}
      />,
    );

    const textarea = screen.getByRole("textbox");
    fireEvent.focus(textarea);
    fireEvent.change(textarea, { target: { value: "he" } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });

    expect(window.hermesAPI.suggestAutocomplete).toHaveBeenCalledWith(
      "he",
      "model-1",
      undefined,
    );
    expect(screen.getByText("there")).toBeInTheDocument();
  });

  it("accepts an llm autocomplete suggestion with Tab", async () => {
    vi.useFakeTimers();
    window.hermesAPI = {
      suggestAutocomplete: vi.fn().mockResolvedValue("there"),
    } as unknown as typeof window.hermesAPI;

    render(
      <ChatInput
        isLoading={false}
        hasSession={false}
        autocompleteSettings={{
          mode: "llm",
          modelRef: "model-1",
          debounceMs: 50,
          minChars: 2,
        }}
        onSubmit={() => {}}
        onQuickAsk={() => {}}
        onAbort={() => {}}
      />,
    );

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.focus(textarea);
    fireEvent.change(textarea, { target: { value: "he" } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });
    fireEvent.keyDown(textarea, { key: "Tab" });

    expect(textarea.value).toBe("he there");
  });

  it("dismisses autocomplete suggestions with Escape until the input changes", async () => {
    vi.useFakeTimers();
    window.hermesAPI = {
      suggestAutocomplete: vi.fn().mockResolvedValue("there"),
    } as unknown as typeof window.hermesAPI;

    render(
      <ChatInput
        isLoading={false}
        hasSession={false}
        autocompleteSettings={{
          mode: "llm",
          modelRef: "model-1",
          debounceMs: 50,
          minChars: 2,
        }}
        onSubmit={() => {}}
        onQuickAsk={() => {}}
        onAbort={() => {}}
      />,
    );

    const textarea = screen.getByRole("textbox");
    fireEvent.focus(textarea);
    fireEvent.change(textarea, { target: { value: "he" } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });
    fireEvent.keyDown(textarea, { key: "Escape" });

    expect(screen.queryByText("there")).not.toBeInTheDocument();

    fireEvent.change(textarea, { target: { value: "hel" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });

    expect(screen.getByText("there")).toBeInTheDocument();
  });

  it("suppresses llm autocomplete suggestions that duplicate the current draft ending", async () => {
    vi.useFakeTimers();
    window.hermesAPI = {
      suggestAutocomplete: vi.fn().mockResolvedValue("there"),
    } as unknown as typeof window.hermesAPI;

    render(
      <ChatInput
        isLoading={false}
        hasSession={false}
        autocompleteSettings={{
          mode: "llm",
          modelRef: "model-1",
          debounceMs: 50,
          minChars: 2,
        }}
        onSubmit={() => {}}
        onQuickAsk={() => {}}
        onAbort={() => {}}
      />,
    );

    const textarea = screen.getByRole("textbox");
    fireEvent.focus(textarea);
    fireEvent.change(textarea, { target: { value: "hello there" } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });

    expect(screen.queryByText("there")).not.toBeInTheDocument();
  });
});
