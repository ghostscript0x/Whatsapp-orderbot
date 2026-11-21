import { ConversationInbox } from "@/components/conversations/inbox";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Conversations" };

export default function ConversationsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader className="mb-0" title="Conversations" description="Chats with your customers. Ones waiting for a person are marked “Needs you”." />
      <ConversationInbox />
    </div>
  );
}
