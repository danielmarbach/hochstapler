Feature: Rematch
  After the game the group plays one more round without creating and joining a new game: the first player to ask
  opens the new lobby (same country, rules and bots) and the others join it from their own results page.

  Background:
    Given Anna and Ben play a game in Switzerland with a bot
    And Anna already owns "Weggisgasse"
    And it is Anna's turn
    When Anna proposes ending the game
    And Ben agrees to end the game

  Scenario: Anna opens the rematch and Ben joins it
    Then the results page for Anna offers a rematch
    And the results page for Ben offers a rematch
    When Anna asks for a rematch
    Then Anna is the host of a new lobby with the bot Heidi vom Pilatus
    And the results page for Ben offers to join the rematch
    When Ben joins the rematch
    Then Ben sits in the same lobby as Anna
    And the lobby for Anna still shows Ben

  Scenario: Ben goes back to the results and finds his seat in the rematch again
    When Anna asks for a rematch
    And Ben joins the rematch
    And Ben goes back to the results
    And Ben joins the rematch
    Then Ben sits in the same lobby as Anna
