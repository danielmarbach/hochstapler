Feature: Chat in a family game
  Chat is for the seated players only. Links, contact data and rude words are blocked, and the host decides
  how much is allowed: free text, quick messages only, or nothing at all.

  Background:
    Given Anna and Ben play a game in Switzerland

  Scenario: A link in a message is blocked with a hint
    When Anna sends the chat message "Schau mal auf example.ch"
    Then Anna sees the chat hint "Links und Webadressen sind im Chat nicht erlaubt."
    When Anna sends the chat message "Gut gespielt"
    Then Ben sees the chat message "Gut gespielt" from Anna
    And Ben has received no other chat message

  Scenario: A spectator sees no chat
    Given Clara watches the game
    When Anna sends the chat message "Geheime Strategie"
    Then Ben sees the chat message "Geheime Strategie" from Anna
    And Clara has no chat and does not see "Geheime Strategie"

  Scenario: The host switches to quick messages
    When Anna switches the chat to quick messages
    Then Ben can only send quick messages
    When Ben sends the quick message "Gut gespielt!"
    Then Anna sees the chat message "Gut gespielt!" from Ben

  Scenario: A muted player cannot write
    When Anna mutes Ben
    Then Ben sees that he is muted and cannot write
    When Anna lets Ben write again
    Then Ben can write in the chat again

  Scenario: The chat is a polite live region and has a visible Send button
    When Anna opens the chat
    Then the chat is labelled as a polite live region for Anna
    And the Send button of Anna is at least 44 pixels high
    When Anna sends "Hallo zusammen" with the Send button
    Then Ben sees the chat message "Hallo zusammen" from Anna

  @desktop
  Scenario: A reader who scrolled up gets a pill instead of being pulled down
    When Anna opens the chat
    And Ben sends the chat message "Eins"
    And Ben sends the chat message "Zwei"
    And Ben sends the chat message "Drei"
    And Ben sends the chat message "Vier"
    And Anna scrolls the chat to the top
    And Ben sends the chat message "Neuer Zug"
    Then Anna sees the pill "Neue Nachrichten"
    And the chat of Anna is still scrolled to the top
    When Anna presses the pill "Neue Nachrichten"
    Then the chat of Anna is scrolled to the bottom
    And Anna does not see the new messages pill

  @desktop
  Scenario: The log button counts unread messages, not all of them
    When Ben sends the chat message "Hallo"
    Then the log button of Anna shows "Protokoll & Chat · 1 neu"
    When Anna opens the chat
    And Anna closes the log panel
    Then the log button of Anna shows "Protokoll & Chat"
