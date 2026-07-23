import type { Component } from "solid-js";
import { For, Show } from "solid-js";
import { theme } from "../theme";
import type {
  CreateField,
  CreateFormState,
  CreateOptions,
} from "../utils/task-create";

interface TaskCreateModalProps {
  form: CreateFormState;
  options: CreateOptions;
  /** The visible fields, in display order (target-ref is conditional). */
  visibleFields: CreateField[];
  /** The currently-focused field (highlighted; the prompt one is editable). */
  focusedField: CreateField;
  /** Whether the form can be submitted (prompt or a prompt-bearing template). */
  valid: boolean;
  onPromptInput: (value: string) => void;
}

const FIELD_LABEL: Record<CreateField, string> = {
  agent: "Agent",
  project: "Project",
  target: "Target",
  targetRef: "Pane",
  template: "Template",
  prompt: "Prompt",
  background: "Background",
  runNow: "Run now",
};

/** Non-prompt field values render as text; ‹ › marks the cyclable ones. */
function displayValue(field: CreateField, props: TaskCreateModalProps): string {
  const f = props.form;
  switch (field) {
    case "agent":
      return `‹ ${f.agent || "—"} ›`;
    case "project":
      return `‹ ${f.project || "—"} ›`;
    case "target":
      return `‹ ${f.target} ›`;
    case "targetRef": {
      const opt = props.options.sessions.find((s) => s.pane === f.targetRef);
      return `‹ ${opt?.label ?? f.targetRef ?? "—"} ›`;
    }
    case "template":
      return `‹ ${f.template || "(none)"} ›`;
    case "background":
      return f.background ? "[x]" : "[ ]";
    case "runNow":
      return f.runNow ? "[x]" : "[ ]";
    default:
      return "";
  }
}

export const TaskCreateModal: Component<TaskCreateModalProps> = (props) => {
  return (
    <box
      position="absolute"
      top="50%"
      left="50%"
      width={62}
      height={16}
      marginTop={-8}
      marginLeft={-31}
      backgroundColor={theme.base}
      borderStyle="single"
      borderColor={theme.border}
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg={theme.text}>
        <strong>New task</strong>
      </text>
      <box height={1} />

      <For each={props.visibleFields}>
        {(field) => {
          const focused = () => props.focusedField === field;
          return (
            <box flexDirection="row" gap={1}>
              <text
                fg={focused() ? theme.blue : theme.overlay}
                width={12}
              >
                {focused() ? "▎" : " "}
                {FIELD_LABEL[field]}
              </text>
              <Show
                when={field === "prompt"}
                fallback={
                  <text fg={focused() ? theme.text : theme.subtext}>
                    {displayValue(field, props)}
                  </text>
                }
              >
                <input
                  value={props.form.prompt}
                  onInput={props.onPromptInput}
                  focused={focused()}
                  placeholder="what should the agent do?"
                  placeholderColor={theme.overlay}
                  textColor={theme.text}
                  cursorColor={theme.blue}
                  backgroundColor="transparent"
                  focusedBackgroundColor="transparent"
                  width={44}
                />
              </Show>
            </box>
          );
        }}
      </For>

      <box height={1} />
      <text fg={theme.overlay}>
        {props.valid
          ? "enter create · ←/→ change · space toggle · esc cancel"
          : "prompt required · ←/→ change · esc cancel"}
      </text>
    </box>
  );
};
