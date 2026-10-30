# AstraCore API Test Report

Status: **BLOCKED**.

Existing architecture has authenticated routes for auth, conversations, knowledge, memory, tools, models, evaluation and agents. The production server rejects chat when no validated production-ready checkpoint is loaded and applies request/body limits. Full release matrix remains incomplete.

Required final matrix: valid, invalid, unauthenticated, unauthorized, malformed, oversized, rate-limited and dependency-failure cases for every release endpoint.
