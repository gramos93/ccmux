import type { Component } from "solid-js";
import { For, Show } from "solid-js";
import { theme } from "../theme";
import type {
  CreateField,
  CreateFormState,
  CreateOptions,
  ProjectChoice,
} from "../utils/task-create";

interface TaskCreateModalProps {
  form: CreateFormState;
  options: CreateOptions;
  /** The visible fields, in display order (target-ref is conditional). */
  visibleFields: CreateField[];
  /** The currently-focused field (highlighted; the prompt one is editable). */
  focusedField: CreateField;
  /** Whether the form can be submitted (prompt/template + a resolved pane). */
  valid: boolean;
  onPromptInput: (value: string) => void;
  // Searchable project picker (sub-overlay).
  projectPickerOpen: boolean;
  projectQuery: string;
  projectChoices: ProjectChoice[];
  projectPickerIndex: number;
  onProjectQueryInput: (value: string) => void;
  onProjectPickerSubmit: () => void;
}

const FIELD_LABEL: Record<CreateField, string> = {
  agent: "Agent",
  project: "Project",
  target: "Target",
  targetRef: "Pane",
  template: "Template",
  prompt: "Prompt",
  runNow: "Run now",
};

/** Non-prompt field values render as text; ‹ › marks the cyclable ones. */
function displayValue(field: CreateField, props: TaskCreateModalProps): string {
  const f = props.form;
  switch (field) {
    case "agent":
      return `‹ ${f.agent || "—"} ›`;
    case "project":
      return `‹ ${f.project || "—"} › (space: search)`;
    case "target":
      return `‹ ${f.target} ›`;
    case "targetRef": {
      const opt = props.options.sessions.find((s) => s.pane === f.targetRef);
      return `‹ ${opt?.label ?? f.targetRef ?? "—"} ›`;
    }
    case "template":
      return `‹ ${f.template || "(none)"} ›`;
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
      width={66}
      height={15}
      marginTop={-7}
      marginLeft={-33}
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
              <text fg={focused() ? theme.blue : theme.overlay} width={12}>
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
                  focused={focused() && !props.projectPickerOpen}
                  placeholder="what should the agent do?"
                  placeholderColor={theme.overlay}
                  textColor={theme.text}
                  cursorColor={theme.blue}
                  backgroundColor="transparent"
                  focusedBackgroundColor="transparent"
                  width={46}
                />
              </Show>
            </box>
          );
        }}
      </For>

      <box height={1} />
      <text fg={theme.overlay}>
        {props.valid
          ? "enter create · ←/→ change · space toggle/search · esc cancel"
          : "needs prompt/template" +
            (props.form.target === "split" ||
            props.form.target === "send-to-existing"
              ? " + a pane · ←/→ change · esc cancel"
              : " · ←/→ change · esc cancel")}
      </text>

      <Show when={props.projectPickerOpen}>
        <box
          position="absolute"
          top={2}
          left={2}
          width={60}
          height={11}
          backgroundColor={theme.surface}
          borderStyle="single"
          borderColor={theme.blue}
          flexDirection="column"
          paddingLeft={1}
          paddingRight={1}
        >
          <box flexDirection="row">
            <text fg={theme.overlay} width={2}>
              /{" "}
            </text>
            <input
              value={props.projectQuery}
              onInput={props.onProjectQueryInput}
              onSubmit={props.onProjectPickerSubmit}
              focused
              placeholder="search projects (or type a path)..."
              placeholderColor={theme.overlay}
              textColor={theme.text}
              cursorColor={theme.blue}
              backgroundColor="transparent"
              focusedBackgroundColor="transparent"
              width="100%"
            />
          </box>
          <box height={1} />
          <Show
            when={props.projectChoices.length > 0}
            fallback={<text fg={theme.overlay}>no matching projects</text>}
          >
            <select
              options={props.projectChoices.map((c) => ({
                name: c.name,
                description: "",
                value: c.value,
              }))}
              selectedIndex={props.projectPickerIndex}
              showDescription={false}
              showScrollIndicator
              selectedBackgroundColor={theme.blue}
              selectedTextColor={theme.base}
              backgroundColor="transparent"
              textColor={theme.text}
              flexGrow={1}
            />
          </Show>
        </box>
      </Show>
    </box>
  );
};
