import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { email } = await req.json();
        const targetEmail = email || user.email;

        console.log(`🔍 Checking visibility for: ${targetEmail}`);

        // Find the target user
        const allUsers = await base44.asServiceRole.entities.User.list(null, 1000);
        const targetUser = allUsers.find(u => u.email?.toLowerCase() === targetEmail.toLowerCase());

        if (!targetUser) {
            return Response.json({ error: 'User not found', email: targetEmail }, { status: 404 });
        }

        // Get ALL cases (admin view)
        const allCases = await base44.asServiceRole.entities.MyCase.list(null, 10000);

        // Find cases that SHOULD belong to this user
        const userCases = allCases.filter(c => {
            const match = 
                c.user_id === targetUser.id ||
                c.created_by?.toLowerCase() === targetEmail.toLowerCase() ||
                c.client_email?.toLowerCase() === targetEmail.toLowerCase() ||
                c.created_by_email?.toLowerCase() === targetEmail.toLowerCase() ||
                c.created_by_id === targetUser.id;
            return match;
        });

        // Check visibility issues
        const issues = [];
        for (const c of userCases) {
            const problems = [];
            
            if (c.user_id !== targetUser.id) {
                problems.push(`user_id: "${c.user_id}" !== "${targetUser.id}"`);
            }
            if (c.created_by !== targetUser.email) {
                problems.push(`created_by: "${c.created_by}" !== "${targetUser.email}"`);
            }
            if (c.client_email !== targetUser.email) {
                problems.push(`client_email: "${c.client_email}" !== "${targetUser.email}"`);
            }
            if (c.created_by_email !== targetUser.email) {
                problems.push(`created_by_email: "${c.created_by_email}" !== "${targetUser.email}"`);
            }

            if (problems.length > 0) {
                issues.push({
                    case_id: c.id,
                    case_number: c.case_number,
                    status: c.status,
                    amount: c.amount_lost,
                    created_date: c.created_date,
                    problems
                });
            }
        });
          }

        return Response.json({
            user: {
                id: targetUser.id,
                email: targetUser.email,
                full_name: targetUser.full_name
            },
            total_cases_found: userCases.length,
            cases_with_issues: issues.length,
            issues,
            summary: issues.length === 0 
                ? `✅ ALL ${userCases.length} CASES PROPERLY LINKED - User should see them`
                : `⚠️ FOUND ${issues.length} CASES WITH VISIBILITY ISSUES - User may not see them`
        });

    } catch (error) {
        console.error("Verification failed:", error);
        return Response.json({ 
            error: error.message,
            stack: error.stack 
        }, { status: 500 });
    }
});