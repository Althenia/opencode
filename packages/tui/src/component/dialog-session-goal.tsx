import type { SessionAutonomyState } from "@opencode-ai/client"
import { useClient } from "../context/client"
import { type DialogContext, useDialog } from "../ui/dialog"
import { DialogPrompt } from "../ui/dialog-prompt"
import { useToast } from "../ui/toast"
import { errorMessage } from "../util/error"

export function DialogSessionGoal(props: {
  sessionID: string
  currentGoal?: string
  onUpdated?: (state: SessionAutonomyState) => void
}) {
  const dialog = useDialog()
  const client = useClient()
  const toast = useToast()

  return (
    <DialogPrompt
      title="Set autonomous goal"
      placeholder="Describe the outcome OpenCode should achieve"
      value={props.currentGoal}
      onConfirm={(value) => {
        const goal = value.trim()
        if (!goal) return
        void client.api.session.autonomy
          .set({ sessionID: props.sessionID, payload: { mode: "goal", goal } })
          .then((state) => {
            props.onUpdated?.(state)
            toast.show({ message: "Goal mode activated", variant: "success", duration: 3000 })
            dialog.clear()
          })
          .catch((error) =>
            toast.show({
              message: `Failed to set goal: ${errorMessage(error)}`,
              variant: "error",
              duration: 5000,
            }),
          )
      }}
      onCancel={() => dialog.clear()}
    />
  )
}

DialogSessionGoal.show = (
  dialog: DialogContext,
  sessionID: string,
  currentGoal?: string,
  onUpdated?: (state: SessionAutonomyState) => void,
) => dialog.replace(() => <DialogSessionGoal sessionID={sessionID} currentGoal={currentGoal} onUpdated={onUpdated} />)
