import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from '@/components/ui/accordion';
import { Info } from 'lucide-react';

export interface ResearchNote {
  term: string;
  body: string;
}

/**
 * Collapsible "Signals & how to read this screen" explainer shared by the
 * six research screens (/risk, /commodities, /book, /flow, /funds, /macro).
 * Follows the Tactical page's What-it-does / How-to-read-it convention, but
 * collapsed so the data stays front-and-center.
 */
export function ResearchNotes({
  notes,
  label = 'Signals & how to read this screen',
}: {
  notes: ResearchNote[];
  label?: string;
}) {
  if (!notes.length) return null;
  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="notes" className="rounded-lg border border-border px-4">
        <AccordionTrigger className="py-3 text-sm hover:no-underline">
          <span className="flex items-center gap-2">
            <Info className="h-4 w-4 text-primary" />
            {label}
          </span>
        </AccordionTrigger>
        <AccordionContent>
          <dl className="space-y-3 pb-1">
            {notes.map(n => (
              <div key={n.term}>
                <dt className="text-sm font-medium">{n.term}</dt>
                <dd className="text-sm leading-relaxed text-muted-foreground">{n.body}</dd>
              </div>
            ))}
          </dl>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
