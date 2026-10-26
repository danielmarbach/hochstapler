@mobile
Feature: Smartphone menu opener
  The collapsed menu always shows a labelled button next to the summary, so the players, properties, board,
  trades and chat are easy to find. Rarely used camera settings live in the "more" menu.

  Background:
    Given Anna and Ben play a game in Switzerland
    And Ben already owns "Weggisgasse"
    And it is Anna's turn

  Scenario: A labelled opener of at least 44 pixels sits beside the summary
    Then the menu opener for Anna is labelled "Menü" and at least 44 pixels big
    And the menu opener for Anna shows no hint
    When Anna taps the menu opener
    Then the menu for Anna is expanded

  Scenario: The opener shows an open trade offer
    When Anna offers Ben 150 for "Weggisgasse"
    Then the menu opener for Ben shows the hint "1 offene Handelsangebote"

  Scenario: The opener shows unread chat messages until they are read
    When Anna sends the chat message "Hallo Ben"
    Then the menu opener for Ben shows the hint "1 neue Chat-Nachrichten"
    # the log tab holds the protocol and the chat: only the chat sub-tab marks the messages as read (DESIGN #78)
    When Ben expands the menu
    And Ben switches to the tab "Log" in the menu
    Then the menu opener for Ben shows the hint "1 neue Chat-Nachrichten"
    When Ben sees the chat message "Hallo Ben" from Anna
    Then the menu opener for Ben shows no hint

  Scenario: Camera and glow switches are in the more menu
    Then Anna has no camera buttons next to the menu
    When Anna opens the game menu
    Then Anna finds the camera switch "Kamera folgt der Figur" in the game menu
    And Anna finds the camera switch "Glow an/aus" in the game menu
