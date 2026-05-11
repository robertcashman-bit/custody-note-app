# Officer Email Templates – Improvement Suggestions

Reference: existing templates in `renderer/email-templates.js`.  
Reply with: **Approve** / **Disapprove** / **Change to: …** for each number.

---

## One complete recommended email per type

Below is **one full recommendation** for each template. Placeholders in square brackets are filled by the app from the record (e.g. `[DS Smith]`, `[James Smith]`, `[Central Police Station]`, `[14/03/2025]`, `[Jane Smith]`).

---

### Type 1: First Attendance – Disclosure Request

**Subject:** `[Forename] [Surname] - [Police Station] - [Date]`  
*(e.g. James Smith - Central Police Station - 14/03/2025)*

**Body (full recommendation):**
```
Dear [OIC Rank and Surname],

I have been asked by [Fee Earner Name] to cover the matter of [Client Forename Surname] at [Police Station Name], on [Date] at [Time of arrival].

Please would you confirm that the attendance will be effective and provide disclosure to this email address.

If you need any further information from me, please do not hesitate to contact me.

Many thanks,

[Fee Earner Name]
```

---

### Type 2: Follow-Up – Outcome Request

**Subject:** `Re: [Forename] [Surname] - [Police Station] - [Date]`  
*(optional: add " - DSCC [Ref]" when available)*

**Body (full recommendation):**
```
Dear [OIC Rank and Surname],

I write further to my attendance upon [Client Forename Surname] at [Police Station Name] on [Date] on behalf of [Firm Name].

I have not yet received a response and would be grateful if you could confirm the outcome of this matter when convenient.

If the client was bailed, please provide the bail return date and time, the police station to which they are bailed, and details of any bail conditions.

If the client was charged, please provide details of the charges, the court date and time, the relevant Magistrates' Court, and whether the client was granted bail or remanded, together with any bail conditions if applicable.

Many thanks,

[Fee Earner Name]
```

*(When outcome is already recorded in the app, the template would instead state the recorded outcome and ask: “Could you please confirm the above details and provide any additional information?”)*

---

### Type 3: No Reply Follow-Up

**Subject:** `Re: [Forename] [Surname] - [Police Station] - [Date]`

**Body (full recommendation):**
```
Dear [OIC Rank and Surname],

I refer to my previous email regarding [Client Forename Surname], following my attendance upon them at [Police Station Name] on behalf of [Firm Name]. I have not yet received a reply and would be grateful if you could confirm the outcome at your earliest convenience.

I would be grateful if you could confirm the outcome of this matter (including any bail return date or charge/court details as appropriate) when convenient.

If you have already replied to the firm, please disregard this email and accept my apologies.

Many thanks,

[Fee Earner Name]
```

---

## Current templates (for comparison)

### Subject line (all templates)
**Current:** `[Forename] [Surname] - [Police Station] - [Date]`  
(e.g. "James Smith - Central Police Station - 14/03/2025")

### Template 1: First Attendance Disclosure Request
**Current body:**
```
Dear [Rank Surname],

I have been asked by [Fee Earner / Firm] to cover this matter on [date] at [time].

Please would you confirm that the attendance will be effective and provide disclosure to the email address below.

Many thanks,

[Fee Earner]
```

### Template 2: Follow-Up / Outcome Request
**Current body:**  
Opener: *"I write further to my attendance upon [client] at [station] Police Station on behalf of [solicitor]."*  
Then outcome-specific bullets (bail/charge details) or generic “please confirm outcome” text.

### Template 3: No Reply Follow-Up
**Current body:**  
Opener: *"I refer to my previous email regarding [client], following my attendance upon them at [station] Police Station on behalf of [solicitor]."*  
Then **concise** outcome request (same content as follow-up but shorter paragraphs).

---

## Numbered improvement suggestions

### Subject line

**1.** Add optional "Re:" for follow-up templates (Template 2 and 3) so the subject becomes  
`Re: James Smith - Central Police Station - 14/03/2025`  
when sending a second or third email.  
→ *Reduces chance the officer treats it as a new case.*

**2.** Add DSCC reference to subject when available, e.g.  
`James Smith - Central PS - 14/03/2025 - DSCC 110154321A`  
→ *Helps OIC identify the case quickly.*

---

### Template 1: First Attendance

**3.** Replace “provide disclosure to the email address below” with:  
“provide disclosure to the email address from which this is sent” (or “to this email address”).  
→ *Clearer when the officer doesn’t see a separate “below”.*

**4.** Add a short line before the sign-off:  
“If you need any further information from me, please do not hesitate to contact me.”  
→ *Offers a clear way for the officer to reply.*

**5.** Add optional reference to client and station in the first line, e.g.  
“I have been asked by [Fee Earner] to cover the matter of [Client name] at [Station]”  
then “on [date] at [time].”  
→ *Identifies client and station in the first sentence.*

**6.** Keep Template 1 as-is (no wording changes).  
→ *Use this if you prefer the current brevity.*

---

### Template 2: Follow-Up / Outcome Request

**7.** Change opener from “I write further to my attendance upon [client]” to:  
“I write further to my attendance upon **[client]** at **[station]** on **[date]** on behalf of **[solicitor]**.”  
→ *Adds date so the officer can match the attendance even without the original email.*

**8.** Add a single short “chase” line after the opener when outcome is unknown, e.g.  
“I have not yet received a response and would be grateful if you could confirm the outcome when convenient.”  
→ *Makes it clear this is a polite chase.*

**9.** When outcome *is* known (bail/charge etc.), add one line before “Could you please confirm…”:  
“I have recorded the following from my attendance. Could you please confirm…”  
→ *Signals you’re summarising your record and asking for confirmation.*

**10.** Keep Template 2 wording as-is (only consider subject/Re: and DSCC from 1–2).  
→ *Use this if you only want subject-line improvements.*

---

### Template 3: No Reply Follow-Up

**11.** Make the “no reply” nature explicit in the opener, e.g.  
“I refer to my email of [date of first email – if we store it] / my previous email regarding [client]…”  
and add: “I have not yet received a reply and would be grateful if you could confirm the outcome at your earliest convenience.”  
→ *Clearly a second chase; requires “first email date” only if you want the exact date.*

**12.** Shorten the no-reply body to a single short paragraph when outcome is unknown, e.g.  
“I would be grateful if you could confirm the outcome of this matter (including any bail return date or charge/court details as appropriate) when convenient.”  
→ *Keeps the email very short for busy officers.*

**13.** Add a line: “If this has already been sent to the firm, please disregard and accept my apologies.”  
→ *Reduces friction if the officer already replied to the firm.*

**14.** Keep Template 3 as-is except for subject (Re: and/or DSCC).  
→ *Use this if you only want subject-line improvements.*

---

### General (all templates)

**15.** Add “Yours sincerely” as an option instead of “Many thanks,” (or offer both and let the user choose in settings).  
→ *More formal if your firm prefers it.*

**16.** Ensure the fallback when OIC name is missing stays “Dear Officer,” (already in code).  
→ *No change; just confirming.*

---

## How to reply

You can reply in one go, for example:

- **Approve:** 1, 2, 3, 5, 7, 8, 11, 12  
- **Disapprove:** 4, 6, 10, 14, 15  
- **Change 9 to:** “Please confirm the above and let me know if anything is incorrect.”  
- **Change 13 to:** “If you have already replied, please disregard this email.”

Once you’ve marked each number, the code changes can be applied to `email-templates.js` (and subject-building logic) accordingly.
