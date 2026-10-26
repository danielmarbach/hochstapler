Feature: Chat settings in the lobby
  The host decides before the game starts how much chat is allowed; everybody can see the choice.

  Scenario: The host sets the chat mode in the lobby and everybody sees it
    Given Anna has opened a game in Switzerland
    And Ben has joined Anna's game
    When Anna opens the lobby
    Then the lobby for Anna shows the chat mode "Frei"
    When Anna sets the chat to quick messages in the lobby
    Then the lobby for Anna shows the chat mode "Schnellnachrichten"
    And the lobby for Ben shows the chat mode "Schnellnachrichten"
