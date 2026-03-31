import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    const { imageBase64, mimeType = 'image/jpeg' } = body as {
      imageBase64: string;
      mimeType?: string;
    };

    if (!imageBase64) {
      return Response.json({ error: 'imageBase64 is required' }, { status: 400 });
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-5.2',
      messages: [
        {
          role: 'system',
          content: `Tu es un expert en inspection de chantier de construction (BTP). Analyse la photo fournie et identifie les défauts, anomalies ou non-conformités visibles.
Réponds UNIQUEMENT avec un objet JSON valide, sans markdown, sans code block, avec exactement ces champs :
{
  "title": "Titre court du défaut (max 60 caractères, en français)",
  "description": "Description détaillée du problème constaté (2-3 phrases, en français, précis et technique)",
  "priority": "low|medium|high|critical",
  "lot": "Lot/Corps d'état concerné parmi : Gros œuvre, Charpente, Couverture, Étanchéité, Menuiserie extérieure, Menuiserie intérieure, Plâtrerie, Isolation, Carrelage, Peinture, Électricité, Plomberie, CVC, VRD, Espaces verts, Autre"
}
Choisis priority "critical" si le défaut est dangereux ou structurel, "high" si impact fonctionnel important, "medium" si notable mais non bloquant, "low" si cosmétique ou mineur.`,
        },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${imageBase64}`,
                detail: 'high',
              },
            } as any,
            {
              type: 'text',
              text: 'Analyse ce défaut de chantier BTP et génère le titre, la description détaillée, la priorité et le lot concerné.',
            },
          ],
        },
      ],
      max_tokens: 512,
      temperature: 0.2,
    });

    const rawContent = completion.choices[0]?.message?.content ?? '{}';
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return Response.json({ error: 'Invalid AI response format' }, { status: 500 });
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      title?: string;
      description?: string;
      priority?: string;
      lot?: string;
    };

    const validPriorities = ['low', 'medium', 'high', 'critical'];
    const priority = validPriorities.includes(parsed.priority ?? '') ? parsed.priority : 'medium';

    return Response.json({
      title: parsed.title ?? '',
      description: parsed.description ?? '',
      priority,
      lot: parsed.lot ?? '',
    });
  } catch (err) {
    console.error('[analyze-photo] error:', err);
    return Response.json({ error: 'Analysis failed' }, { status: 500 });
  }
}
