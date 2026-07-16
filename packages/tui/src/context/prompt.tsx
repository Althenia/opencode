import { createSimpleContext } from "./helper"
import type { PromptRef } from "../component/prompt"

export const { use: usePromptRef, provider: PromptRefProvider } = createSimpleContext({
  name: "PromptRef",
  init: () => {
    let current: PromptRef | undefined
    let submissionRevision = 0

    return {
      get current() {
        return current
      },
      set(ref: PromptRef | undefined) {
        current = ref
      },
      get submissionRevision() {
        return submissionRevision
      },
      beginSubmission() {
        return ++submissionRevision
      },
    }
  },
})
