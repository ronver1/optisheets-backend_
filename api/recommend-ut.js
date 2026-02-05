export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

    const { licenseKey, student, completedCourses, candidateCourses } = req.body || {};
    if (!licenseKey || !student || !Array.isArray(completedCourses) || !Array.isArray(candidateCourses)) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    // --- Basic license key gate (upgrade later to DB/HMAC) ---
    if (typeof licenseKey !== "string" || licenseKey.trim().length < 10) {
      return res.status(401).json({ error: "Invalid license key." });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Server missing OPENAI_API_KEY." });

    // Keep candidate list from exploding cost
    const cappedCandidates = candidateCourses.slice(0, 180);

    const prompt = `
You are an academic planning assistant for UT Austin.

Rules:
- You MUST ONLY recommend courses that appear in the provided candidateCourses list.
- Return recommendations that are reasonable for raising GPA (high likelihood of A/A-), and feasible given the student's context.
- Prefer 1-credit seminars / manageable electives when appropriate, and suggest retakes strategically (if they have low grades).
- If you are uncertain about a course, mark difficulty as "Unknown".

Return ONLY valid JSON in this exact schema:
{
  "recommendations": [
    {
      "course_code": "string",
      "course_title": "string",
      "credits": number|null,
      "target_grade": "A|A-|B+|B|etc",
      "why_this_course": "string",
      "difficulty_note": "Easy|Moderate|Hard|Unknown",
      "source": "catalog_url_or_blank"
    }
  ]
}

Student:
${JSON.stringify(student, null, 2)}

Completed courses:
${JSON.stringify(completedCourses, null, 2)}

Candidate courses:
${JSON.stringify(cappedCandidates, null, 2)}
    `.trim();

    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-5.2",
        input: prompt
      })
    });

    if (!resp.ok) {
      const err = await resp.text();
      return res.status(500).json({ error: "OpenAI API error", details: err });
    }

    const data = await resp.json();
    const outputText = data.output_text || "";

    let parsed;
    try {
      parsed = JSON.parse(outputText);
    } catch {
      return res.status(500).json({ error: "Model did not return valid JSON.", raw: outputText });
    }

    return res.status(200).json(parsed);
  } catch (e) {
    return res.status(500).json({ error: "Server error", details: String(e) });
  }
}
