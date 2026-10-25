/**
 * A prompt as its reader wrote it (REVIEW-8 #5: the first message rendered raw JSON with literal \n\n). The CLI bridge
 * frames every user turn as "[system] <session resources and permission posture>\n\n[user] <payload>"; the frame is the
 * same on every turn and stays in the event's source (Details). A payload that is a JSON assignment (program, idea,
 * objective, instruction, ...) reads as its objective and instruction; any other payload is shown as written.
 */
export function promptText(text: string): string {
  const at = text.indexOf('[user] ')
  const payload = text.startsWith('[system] ') && at >= 0 ? text.slice(at + '[user] '.length).trim() : text.trim()
  if (!payload.startsWith('{')) return payload
  try {
    const value = JSON.parse(payload) as Record<string, unknown>
    const parts = ['objective', 'instruction'].map((key) => value[key]).filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    return parts.length ? parts.join('\n\n') : payload
  } catch {
    return payload
  }
}
