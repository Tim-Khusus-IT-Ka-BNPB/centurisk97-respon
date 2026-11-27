import { z } from "zod";
import { COMMENT_FIGURES, COMMENT_MAX } from "../domain/comments";
import { timeSchema } from "./common";

const commentId = z.string().regex(/^[0-9a-f]{16}$/);

// A card's comments as everyone reads them (upstream lapor_komen, row 30): the words and the minute,
// shown as "Warga", never a name or a number.
const commentSchema = z.strictObject({ id: commentId, text: z.string(), at: timeSchema });
export const commentsSchema = z.strictObject({ comments: z.array(commentSchema) });
export type Comments = z.infer<typeof commentsSchema>;

export const newCommentSchema = z.strictObject({ text: z.string().max(COMMENT_MAX * 2) });
export const postedCommentSchema = z.strictObject({ comment: commentSchema });
export const reportedCommentSchema = z.strictObject({ counted: z.boolean() });

// The desk's view of a card's comments: every one with how often it was reported, how many of its
// author's comments were hidden, the figures read from it, and what was decided.
export const deskCommentsSchema = z.object({
  items: z.array(
    z.object({
      id: commentId,
      text: z.string(),
      status: z.enum(["shown", "reported", "hidden"]),
      reports: z.number().int().nonnegative(),
      at: timeSchema,
      authorHidden: z.number().int().nonnegative(),
      figures: z.array(
        z.object({
          id: z.number().int(),
          figure: z.enum(COMMENT_FIGURES),
          value: z.number().int().nonnegative(),
          quote: z.string(),
          status: z.enum(["proposed", "accepted", "rejected"]),
        }),
      ),
      decisions: z.array(
        z.object({
          action: z.enum(["accept", "reject", "hide", "show"]),
          fieldId: z.string().nullable(),
          reason: z.string().nullable(),
          by: z.string(),
          at: timeSchema,
        }),
      ),
    }),
  ),
});
export type DeskComments = z.infer<typeof deskCommentsSchema>;
