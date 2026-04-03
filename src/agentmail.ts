import type { Tool } from 'ollama';
import { AgentMailClient } from 'agentmail';

let _client: AgentMailClient | undefined;

export function getAgentMailClient(): AgentMailClient {
  const key = process.env.AGENTMAIL_API_KEY;
  if (!key) {
    throw new Error(
      'AGENTMAIL_API_KEY is not set. Get a key at https://console.agentmail.to/',
    );
  }
  if (!_client) _client = new AgentMailClient({ apiKey: key });
  return _client;
}

/** Resolve inbox id from args or AGENTMAIL_INBOX_ID. */
export function resolveInboxId(explicit?: string): string {
  const id = explicit || process.env.AGENTMAIL_INBOX_ID;
  if (!id) {
    throw new Error(
      'inbox_id is required (or set AGENTMAIL_INBOX_ID for a default inbox)',
    );
  }
  return id;
}

const MAX_BODY = 24_000;
const TRUNC_KEYS = new Set([
  'text',
  'html',
  'extractedText',
  'extractedHtml',
  'preview',
  'raw',
]);

export function truncateForLlm(obj: unknown, depth = 0): unknown {
  if (depth > 14) return '[max depth]';
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return obj.toString();
  if (obj instanceof Date) return obj.toISOString();
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((x) => truncateForLlm(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (TRUNC_KEYS.has(k) && typeof v === 'string' && v.length > MAX_BODY) {
      out[k] =
        v.slice(0, MAX_BODY) +
        `… [truncated ${v.length - MAX_BODY} more chars; use get_message for full body if needed]`;
    } else {
      out[k] = truncateForLlm(v, depth + 1);
    }
  }
  return out;
}

export function stringifyAgentmailResult(data: unknown): string {
  return JSON.stringify(truncateForLlm(data), null, 2);
}

function amErr(err: unknown): string {
  const e = err as { body?: { message?: string }; message?: string };
  const msg = e?.body?.message ?? e?.message ?? String(err);
  return JSON.stringify({ error: msg });
}

function parseIsoDate(v: unknown): Date | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function listOpts(args: Record<string, unknown>) {
  const raw = {
    limit: args.limit as number | undefined,
    pageToken: args.page_token as string | undefined,
    labels: args.labels as string[] | undefined,
    before: parseIsoDate(args.before),
    after: parseIsoDate(args.after),
    ascending: args.ascending as boolean | undefined,
    includeSpam: args.include_spam as boolean | undefined,
    includeBlocked: args.include_blocked as boolean | undefined,
    includeTrash: args.include_trash as boolean | undefined,
  };
  return Object.fromEntries(
    Object.entries(raw).filter(([, v]) => v !== undefined && v !== null),
  ) as typeof raw;
}

export const agentmailTools: Tool[] = [
  {
    type: 'function',
    function: {
      name: 'agentmail_list_inboxes',
      description:
        'List AgentMail inboxes for this API key. Docs: https://docs.agentmail.to/',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'agentmail_create_inbox',
      description:
        'Create a new AgentMail inbox. Use client_id for idempotent retries (same id = no duplicate inbox).',
      parameters: {
        type: 'object',
        properties: {
          username: { type: 'string', description: 'Local part (optional)' },
          domain: { type: 'string', description: 'Domain (optional; default @agentmail.to)' },
          display_name: { type: 'string' },
          client_id: { type: 'string', description: 'Idempotency key for safe retries' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'agentmail_send_email',
      description:
        'Send an email from an inbox. Supports plain+HTML, CC/BCC, Reply-To, custom headers, and attachments (base64 content or url per attachment).',
      parameters: {
        type: 'object',
        properties: {
          inbox_id: {
            type: 'string',
            description: 'Defaults to AGENTMAIL_INBOX_ID if omitted',
          },
          to: {
            type: 'array',
            items: { type: 'string' },
            description: 'Recipient email addresses',
          },
          subject: { type: 'string' },
          text: { type: 'string', description: 'Plain text body' },
          html: { type: 'string', description: 'HTML body' },
          cc: { type: 'array', items: { type: 'string' } },
          bcc: { type: 'array', items: { type: 'string' } },
          reply_to: { type: 'array', items: { type: 'string' } },
          attachments: {
            type: 'array',
            description:
              'Each: { filename?, contentType?, content? (base64), url? }',
            items: { type: 'object' },
          },
          headers: { type: 'object', description: 'Custom MIME headers' },
        },
        required: ['to', 'subject'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'agentmail_list_messages',
      description:
        'List messages in an inbox (pagination, label filters, spam/trash options). Prefer extractedText for reply-ready text.',
      parameters: {
        type: 'object',
        properties: {
          inbox_id: { type: 'string', description: 'Defaults to AGENTMAIL_INBOX_ID' },
          limit: { type: 'number' },
          page_token: { type: 'string' },
          labels: { type: 'array', items: { type: 'string' } },
          before: { type: 'string' },
          after: { type: 'string' },
          ascending: { type: 'boolean' },
          include_spam: { type: 'boolean' },
          include_blocked: { type: 'boolean' },
          include_trash: { type: 'boolean' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'agentmail_get_message',
      description:
        'Fetch a full message by id (body may be large; response is truncated for the model).',
      parameters: {
        type: 'object',
        properties: {
          inbox_id: { type: 'string', description: 'Defaults to AGENTMAIL_INBOX_ID' },
          message_id: { type: 'string' },
        },
        required: ['message_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'agentmail_reply_email',
      description: 'Reply to a specific message (not reply-all).',
      parameters: {
        type: 'object',
        properties: {
          inbox_id: { type: 'string' },
          message_id: { type: 'string' },
          text: { type: 'string' },
          html: { type: 'string' },
          cc: { type: 'array', items: { type: 'string' } },
          bcc: { type: 'array', items: { type: 'string' } },
          attachments: { type: 'array', items: { type: 'object' } },
        },
        required: ['message_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'agentmail_reply_all_email',
      description: 'Reply-all to a message.',
      parameters: {
        type: 'object',
        properties: {
          inbox_id: { type: 'string' },
          message_id: { type: 'string' },
          text: { type: 'string' },
          html: { type: 'string' },
          attachments: { type: 'array', items: { type: 'object' } },
        },
        required: ['message_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'agentmail_forward_email',
      description: 'Forward a message to new recipient(s).',
      parameters: {
        type: 'object',
        properties: {
          inbox_id: { type: 'string' },
          message_id: { type: 'string' },
          to: { type: 'array', items: { type: 'string' }, description: 'Forward recipients' },
          subject: { type: 'string' },
          text: { type: 'string' },
          html: { type: 'string' },
          cc: { type: 'array', items: { type: 'string' } },
          bcc: { type: 'array', items: { type: 'string' } },
        },
        required: ['message_id', 'to'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'agentmail_update_message_labels',
      description: 'Add or remove labels on a message.',
      parameters: {
        type: 'object',
        properties: {
          inbox_id: { type: 'string' },
          message_id: { type: 'string' },
          add_labels: { type: 'array', items: { type: 'string' } },
          remove_labels: { type: 'array', items: { type: 'string' } },
        },
        required: ['message_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'agentmail_list_threads',
      description:
        'List threads. If inbox_id is set, scopes to that inbox; if omitted, lists organization-wide threads.',
      parameters: {
        type: 'object',
        properties: {
          inbox_id: { type: 'string', description: 'Omit for org-wide thread list' },
          limit: { type: 'number' },
          page_token: { type: 'string' },
          labels: { type: 'array', items: { type: 'string' } },
          before: { type: 'string' },
          after: { type: 'string' },
          ascending: { type: 'boolean' },
          include_spam: { type: 'boolean' },
          include_blocked: { type: 'boolean' },
          include_trash: { type: 'boolean' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'agentmail_get_thread',
      description:
        'Get one thread. With inbox_id: inbox-scoped get. Without: organization thread by thread_id.',
      parameters: {
        type: 'object',
        properties: {
          inbox_id: { type: 'string' },
          thread_id: { type: 'string' },
        },
        required: ['thread_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'agentmail_update_thread_labels',
      description:
        'Add/remove custom labels on a thread (cannot change system labels).',
      parameters: {
        type: 'object',
        properties: {
          inbox_id: { type: 'string' },
          thread_id: { type: 'string' },
          add_labels: { type: 'array', items: { type: 'string' } },
          remove_labels: { type: 'array', items: { type: 'string' } },
        },
        required: ['thread_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'agentmail_delete_thread',
      description:
        'Trash or permanently delete a thread (inbox-scoped). If already in trash, deletes permanently unless permanent=true.',
      parameters: {
        type: 'object',
        properties: {
          inbox_id: { type: 'string' },
          thread_id: { type: 'string' },
          permanent: { type: 'boolean', description: 'Force permanent delete' },
        },
        required: ['thread_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'agentmail_get_attachment',
      description:
        'Get a signed download URL and metadata for a message attachment (not raw bytes).',
      parameters: {
        type: 'object',
        properties: {
          inbox_id: { type: 'string' },
          message_id: { type: 'string' },
          attachment_id: { type: 'string' },
        },
        required: ['message_id', 'attachment_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'agentmail_webhooks_list',
      description: 'List registered AgentMail webhooks.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number' },
          page_token: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'agentmail_webhooks_create',
      description:
        'Register a webhook URL for events (e.g. message.received, message.sent). Use webhooks_get to read signing secret for verification (Svix).',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'HTTPS endpoint' },
          event_types: {
            type: 'array',
            items: { type: 'string' },
            description:
              'e.g. message.received, message.sent, message.delivered, message.bounced, message.complained, message.rejected, domain.verified',
          },
          inbox_ids: { type: 'array', items: { type: 'string' } },
          pod_ids: { type: 'array', items: { type: 'string' } },
          client_id: { type: 'string', description: 'Idempotency key' },
        },
        required: ['url', 'event_types'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'agentmail_webhooks_get',
      description:
        'Get webhook details including secret for signature verification.',
      parameters: {
        type: 'object',
        properties: {
          webhook_id: { type: 'string' },
        },
        required: ['webhook_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'agentmail_webhooks_delete',
      description: 'Delete a webhook by id.',
      parameters: {
        type: 'object',
        properties: {
          webhook_id: { type: 'string' },
        },
        required: ['webhook_id'],
      },
    },
  },
];

export async function handleAgentmailTool(
  name: string,
  args: Record<string, any>,
): Promise<string> {
  try {
    const c = getAgentMailClient();
    switch (name) {
      case 'agentmail_list_inboxes': {
        const res = await c.inboxes.list();
        return stringifyAgentmailResult(res);
      }
      case 'agentmail_create_inbox': {
        const res = await c.inboxes.create({
          username: args.username,
          domain: args.domain,
          displayName: args.display_name,
          clientId: args.client_id,
        });
        return stringifyAgentmailResult(res);
      }
      case 'agentmail_send_email': {
        const inboxId = resolveInboxId(args.inbox_id);
        const res = await c.inboxes.messages.send(inboxId, {
          to: args.to,
          subject: args.subject,
          text: args.text,
          html: args.html,
          cc: args.cc,
          bcc: args.bcc,
          replyTo: args.reply_to,
          attachments: args.attachments,
          headers: args.headers,
        });
        return stringifyAgentmailResult(res);
      }
      case 'agentmail_list_messages': {
        const inboxId = resolveInboxId(args.inbox_id);
        const res = await c.inboxes.messages.list(inboxId, listOpts(args));
        return stringifyAgentmailResult(res);
      }
      case 'agentmail_get_message': {
        const inboxId = resolveInboxId(args.inbox_id);
        const res = await c.inboxes.messages.get(inboxId, args.message_id);
        return stringifyAgentmailResult(res);
      }
      case 'agentmail_reply_email': {
        const inboxId = resolveInboxId(args.inbox_id);
        const res = await c.inboxes.messages.reply(inboxId, args.message_id, {
          text: args.text,
          html: args.html,
          cc: args.cc,
          bcc: args.bcc,
          attachments: args.attachments,
        });
        return stringifyAgentmailResult(res);
      }
      case 'agentmail_reply_all_email': {
        const inboxId = resolveInboxId(args.inbox_id);
        const res = await c.inboxes.messages.replyAll(inboxId, args.message_id, {
          text: args.text,
          html: args.html,
          attachments: args.attachments,
        });
        return stringifyAgentmailResult(res);
      }
      case 'agentmail_forward_email': {
        const inboxId = resolveInboxId(args.inbox_id);
        const res = await c.inboxes.messages.forward(inboxId, args.message_id, {
          to: args.to,
          subject: args.subject,
          text: args.text,
          html: args.html,
          cc: args.cc,
          bcc: args.bcc,
        });
        return stringifyAgentmailResult(res);
      }
      case 'agentmail_update_message_labels': {
        const inboxId = resolveInboxId(args.inbox_id);
        const res = await c.inboxes.messages.update(inboxId, args.message_id, {
          addLabels: args.add_labels,
          removeLabels: args.remove_labels,
        });
        return stringifyAgentmailResult(res);
      }
      case 'agentmail_list_threads': {
        const opts = listOpts(args);
        if (args.inbox_id) {
          const res = await c.inboxes.threads.list(args.inbox_id, opts);
          return stringifyAgentmailResult(res);
        }
        const res = await c.threads.list(opts);
        return stringifyAgentmailResult(res);
      }
      case 'agentmail_get_thread': {
        if (args.inbox_id) {
          const res = await c.inboxes.threads.get(args.inbox_id, args.thread_id);
          return stringifyAgentmailResult(res);
        }
        const res = await c.threads.get(args.thread_id);
        return stringifyAgentmailResult(res);
      }
      case 'agentmail_update_thread_labels': {
        if (!args.inbox_id) {
          return JSON.stringify({
            error:
              'inbox_id is required for thread label updates (inbox-scoped API)',
          });
        }
        const res = await c.inboxes.threads.update(args.inbox_id, args.thread_id, {
          addLabels: args.add_labels,
          removeLabels: args.remove_labels,
        });
        return stringifyAgentmailResult(res);
      }
      case 'agentmail_delete_thread': {
        if (!args.inbox_id) {
          return JSON.stringify({
            error: 'inbox_id is required to delete a thread',
          });
        }
        await c.inboxes.threads.delete(args.inbox_id, args.thread_id, {
          permanent: args.permanent,
        });
        return JSON.stringify({ ok: true, thread_id: args.thread_id });
      }
      case 'agentmail_get_attachment': {
        const inboxId = resolveInboxId(args.inbox_id);
        const res = await c.inboxes.messages.getAttachment(
          inboxId,
          args.message_id,
          args.attachment_id,
        );
        return stringifyAgentmailResult(res);
      }
      case 'agentmail_webhooks_list': {
        const res = await c.webhooks.list({
          limit: args.limit,
          pageToken: args.page_token,
        });
        return stringifyAgentmailResult(res);
      }
      case 'agentmail_webhooks_create': {
        const res = await c.webhooks.create({
          url: args.url,
          eventTypes: args.event_types,
          inboxIds: args.inbox_ids,
          podIds: args.pod_ids,
          clientId: args.client_id,
        });
        return stringifyAgentmailResult(res);
      }
      case 'agentmail_webhooks_get': {
        const res = await c.webhooks.get(args.webhook_id);
        return stringifyAgentmailResult(res);
      }
      case 'agentmail_webhooks_delete': {
        await c.webhooks.delete(args.webhook_id);
        return JSON.stringify({ ok: true, webhook_id: args.webhook_id });
      }
      default:
        return JSON.stringify({ error: `Unknown AgentMail tool: ${name}` });
    }
  } catch (err) {
    return amErr(err);
  }
}
