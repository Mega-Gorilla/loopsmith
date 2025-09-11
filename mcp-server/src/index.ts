#!/usr/bin/env node

/**
 * MCP Server Entry Point (CommonJS wrapper for stdio server)
 * 
 * This file serves as the main entry point for the MCP server,
 * wrapping the stdio implementation for compatibility.
 */

// Simply re-export the stdio server
require('./server-stdio.js');